#include <Arduino.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <cstdio>
#include <cstring>
#include "config.h"
#include "src/device_core.h"
#include "src/hardware.h"
#include "src/protocol.h"
#include "src/transport.h"

#if !ARDUINO_USB_CDC_ON_BOOT
#error "Enable USB CDC On Boot so the receiver can reach the bracelet over USB."
#endif

Identity identity;
SensorHub sensors;
device::Session session;
device::UsbCaptureGate usbHost;
device::UsbCaptureGate fitnessHost;
device::FitnessCapture fitnessCapture;
device::Site configuredSite = device::Site::Finger;
device::Reading latest;
bool rawEnabled = false;
bool buttonLast = false, buttonStable = false;
uint64_t buttonChangedAt = 0, evaluateAt = 0, helloAt = 0, ackFlashUntil = 0, blockedFlashUntil = 0;
uint64_t opticalRetryAt = 0;
char packet[config::PACKET_BYTES];

uint64_t clockMs() { return static_cast<uint64_t>(esp_timer_get_time()) / 1000; }
size_t frameEncoder(char* out, size_t capacity, size_t index) {
    return encodeFrame(out, capacity, identity, session, index);
}
void hello(Link link, uint64_t now) {
    if (encodeHello(packet, sizeof(packet), identity, session, configuredSite, sensors, now, transport::rawDropped()))
        transport::queueControl(link, packet);
}
void reply(Link link, const char* id, bool ok, const char* error = nullptr) {
    if (encodeReply(packet, sizeof(packet), identity, id, ok, error)) transport::queueControl(link, packet);
}
void onRaw(const RawSample& raw) {
    if (!rawEnabled || !session.active() || !transport::connected(Link::Usb)) return;
    if (encodeRaw(packet, sizeof(packet), identity, raw, session.id(), sensors.fifoOverflows()))
        transport::queueRaw(packet);
}
void handleFitness(uint64_t now) {
    if (!fitnessHost.ready(now, transport::connected(Link::Usb))) {
        fitnessCapture.reset();
        return;
    }
    fitnessCapture.poll(now, [&] { return sensors.reading(now); },
                        [](uint64_t start, const device::FitnessCapture::Samples& samples) {
        if (encodeFitnessWindow(packet, sizeof(packet), identity, start, samples))
            transport::queueFitness(packet);
    });
}
void handleButton(uint64_t now) {
    const bool pressed = digitalRead(config::BUTTON_PIN) == LOW;
    if (pressed != buttonLast) { buttonLast = pressed; buttonChangedAt = now; }
    if (now - buttonChangedAt < 35 || pressed == buttonStable) return;
    buttonStable = pressed;
    if (!pressed) return;
    if (session.active()) { session.cancel(now); sensors.stop(); return; }
    if (!session.start(now, configuredSite)) { blockedFlashUntil = now + 2000; return; }
    evaluateAt = now;
    if (!sensors.start(configuredSite, now)) session.fail(clockMs(), "optical_sensor_unavailable");
}
void handleAutomaticCapture(uint64_t now) {
    if (sensors.opticalFailed()) {
        session.fail(now, "optical_bus_or_reset_fault");
        sensors.stop();
        opticalRetryAt = clockMs() + 5000;
    }
    // Preserve all frames until the laptop confirms durable storage.
    if (!session.active() && session.pending()) return;
    // get_status is the host's automatic heartbeat, including while it saves a session.
    if (config::USB_DEMO && !session.active() && !usbHost.ready(now, transport::connected(Link::Usb))) {
        if (sensors.opticalRunning()) sensors.stop();
        return;
    }
    if (!sensors.opticalRunning()) {
        if (now < opticalRetryAt) return;
        if (!sensors.start(configuredSite, now)) {
            opticalRetryAt = clockMs() + 5000;
            return;
        }
    }
    if (now - evaluateAt >= 1000) {
        latest = sensors.reading(now);
        // Align active evaluations with the session clock and skip missed seconds.
        evaluateAt += ((now - evaluateAt) / 1000) * 1000;
        if (session.startWhenReady(now, configuredSite, latest)) evaluateAt = now;
    }
    session.tick(now, latest);
}
void handleCommand(const Command& command, uint64_t now) {
    if (command.oversized) { reply(command.link, nullptr, false, "command_too_long"); return; }
    JsonDocument doc;
    if (deserializeJson(doc, command.json) || !doc.is<JsonObject>()) {
        reply(command.link, nullptr, false, "invalid_json"); return;
    }
    const char* id = doc["command_id"].is<const char*>() ? doc["command_id"].as<const char*>() : nullptr;
    if (!id || std::strlen(id) > 32 || !doc["v"].is<int>() || doc["v"].as<int>() != 1 ||
        !doc["cmd"].is<const char*>()) { reply(command.link, nullptr, false, "invalid_command"); return; }
    const char* cmd = doc["cmd"];
    if (std::strcmp(cmd, "get_status") == 0) {
        if (config::USB_DEMO && command.link == Link::Usb) {
            usbHost.noteStatus(now);
            if (doc["fitness"].is<bool>() && doc["fitness"].as<bool>()) fitnessHost.noteStatus(now);
            else fitnessHost = {};
        }
        hello(command.link, now); reply(command.link, id, true);
    } else if (std::strcmp(cmd, "set_mode") == 0) {
        const char* site = doc["optical_site"] | "";
        if (session.active() || session.pending()) reply(command.link, id, false, "session_pending");
        else if (std::strcmp(site, "wrist") == 0 && !config::ALLOW_WRIST_TRIAL)
            reply(command.link, id, false, "wrist_not_supported");
        else if (std::strcmp(site, "wrist") != 0 && std::strcmp(site, "finger") != 0)
            reply(command.link, id, false, "invalid_site");
        else {
            configuredSite = std::strcmp(site, "wrist") == 0 ? device::Site::Wrist : device::Site::Finger;
            reply(command.link, id, true); hello(command.link, now);
        }
    } else if (std::strcmp(cmd, "cancel") == 0) {
        if (!session.active()) reply(command.link, id, false, "no_active_session");
        else {
            session.cancel(now);
            if (!config::AUTOMATIC_CAPTURE) sensors.stop();
            reply(command.link, id, true);
        }
    } else if (std::strcmp(cmd, "replay") == 0) {
        transport::replay(command.link); reply(command.link, id, true);
    } else if (std::strcmp(cmd, "ack") == 0) {
        const char* boot = doc["boot_id"] | "";
        if (std::strcmp(boot, identity.bootId) != 0 || !doc["session_id"].is<uint32_t>() ||
            !doc["last_seq"].is<uint32_t>() ||
            !session.acknowledge(doc["session_id"].as<uint32_t>(), doc["last_seq"].as<uint32_t>()))
            reply(command.link, id, false, "ack_mismatch_or_active");
        else { ackFlashUntil = now + 2000; reply(command.link, id, true); }
    } else if (std::strcmp(cmd, "raw") == 0) {
        if (command.link != Link::Usb || !doc["enabled"].is<bool>())
            reply(command.link, id, false, "raw_requires_usb_and_boolean");
        else { rawEnabled = doc["enabled"].as<bool>(); reply(command.link, id, true); }
    } else reply(command.link, id, false, "unknown_command");
}
void updateLed(uint64_t now) {
    bool on = false;
    if (now < blockedFlashUntil) on = now % 200 < 100;
    else if (session.active()) on = now % 1000 < (session.state() == device::State::Recording ? 500 : 100);
    else if (now < ackFlashUntil) on = true;
    else if (session.state() == device::State::Fault) on = now % 1200 < 600 && now % 200 < 100;
    else if (session.pending()) on = now % 2000 < 100 || (now % 2000 >= 250 && now % 2000 < 350);
    else on = now % 3000 < 40;
    digitalWrite(config::LED_PIN, on ? HIGH : LOW);
}
void setup() {
    if (!config::AUTOMATIC_CAPTURE) {
        pinMode(config::LED_PIN, OUTPUT);
        pinMode(config::BUTTON_PIN, INPUT_PULLUP);
    }
    const uint64_t mac = ESP.getEfuseMac();
    std::snprintf(identity.deviceId, sizeof(identity.deviceId), "bracelet-%012llx", static_cast<unsigned long long>(mac));
    sensors.begin(clockMs());
    sensors.onRaw = onRaw;
    transport::begin(identity.deviceId);
    uint64_t random = 0;
    esp_fill_random(&random, sizeof(random));
    std::snprintf(identity.bootId, sizeof(identity.bootId), "%016llx", static_cast<unsigned long long>(random));
    // Start independently of the USB serial connection.
}
void loop() {
    uint64_t now = clockMs();
    sensors.poll(now, session.active());
    now = clockMs();
    if (config::AUTOMATIC_CAPTURE) handleAutomaticCapture(now);
    else {
        handleButton(now);
        if (session.active()) {
            if (sensors.opticalFailed()) session.fail(now, "optical_bus_or_reset_fault");
            else {
                if (now - evaluateAt >= 1000) { latest = sensors.reading(now); evaluateAt = now; }
                session.tick(now, latest);
            }
            if (!session.active()) sensors.stop();
        }
    }
    transport::poll(now, session.id(), session.size(), frameEncoder);
    for (const auto link : {Link::Usb, Link::Ble, Link::Wifi}) {
        if (!transport::takeConnectedEvent(link)) continue;
        if (config::USB_DEMO && link == Link::Usb) {
            fitnessHost = {};
            fitnessCapture.reset();
        }
        hello(link, now);
    }
    Command command;
    // One command per iteration keeps command traffic from starving sensor acquisition.
    if (transport::nextCommand(command)) handleCommand(command, now);
    if (config::USB_DEMO) handleFitness(now);
    if (!session.active() && now - helloAt >= 5000) {
        helloAt = now; hello(Link::Usb, now); hello(Link::Ble, now); hello(Link::Wifi, now);
    }
    if (!config::AUTOMATIC_CAPTURE) updateLed(now);
    delay(1);
}
