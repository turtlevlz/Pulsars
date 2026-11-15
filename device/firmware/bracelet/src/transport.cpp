#include "transport.h"
#include <Arduino.h>
#ifndef PLAN_A_USB_DEMO
#include <NimBLEDevice.h>
#endif
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <algorithm>
#include <atomic>
#include <cstring>
#ifdef PLAN_A_WIFI
#include <WiFi.h>
#include <lwip/sockets.h>
#include <cerrno>
#if __has_include("../wifi-local.h")
#include "../wifi-local.h"
#else
constexpr char WIFI_SSID[] = "";
constexpr char WIFI_PASSWORD[] = "";
#endif
#endif

namespace {
QueueHandle_t commandQueue = nullptr;
std::atomic<uint32_t> droppedCommands{0};
#ifndef PLAN_A_USB_DEMO
std::atomic<uint32_t> bleGeneration{0};
std::atomic<uint16_t> peerHandle{0xffff}, payloadBytes{20};
std::atomic<bool> subscribed{false};
NimBLECharacteristic* tx = nullptr;
#endif

struct Parser {
    char data[config::COMMAND_BYTES]{};
    size_t used = 0;
    bool oversized = false;
    void reset() { used = 0; oversized = false; }
    void feed(uint8_t byte, Link link, uint32_t generation) {
        if (byte == '\r') return;
        if (byte == '\n') {
            if (used || oversized) {
                Command command;
                command.link = link; command.generation = generation; command.oversized = oversized;
                std::memcpy(command.json, data, used); command.json[used] = 0;
                if (xQueueSend(commandQueue, &command, 0) != pdTRUE) ++droppedCommands;
            }
            reset(); return;
        }
        if (used + 1 >= sizeof(data)) { oversized = true; return; }
        if (!oversized) data[used++] = static_cast<char>(byte);
    }
} usbParser;
#ifndef PLAN_A_USB_DEMO
Parser bleParser;
#endif

template<size_t Capacity = 4>
struct PacketQueue {
    char items[Capacity][config::PACKET_BYTES]{};
    size_t head = 0, count = 0;
    bool push(const char* value) {
        const size_t length = std::strlen(value);
        if (!length || length >= config::PACKET_BYTES || count == Capacity) return false;
        std::memcpy(items[(head + count) % Capacity], value, length + 1); ++count; return true;
    }
    bool pop(char* out) {
        if (!count) return false;
        std::strcpy(out, items[head]); head = (head + 1) % Capacity; --count; return true;
    }
    void reset() { head = count = 0; }
};
struct Output {
    PacketQueue<> control;
    char current[config::PACKET_BYTES]{};
    size_t length = 0, offset = 0, cursor = 0;
    uint32_t sessionId = 0, generation = 0;
    bool connected = false, event = false;
    void reconnect(bool value, uint32_t gen) {
        connected = value; generation = gen; cursor = 0;
        length = offset = 0; control.reset(); event = value;
    }
} output[3];
PacketQueue<> raw;
PacketQueue<1> fitness;
uint32_t droppedRaw = 0, usbGeneration = 0;
#ifndef PLAN_A_USB_DEMO
uint64_t bleLastSend = 0;
#endif

#ifdef PLAN_A_WIFI
constexpr uint16_t WIFI_PORT = 8765;
WiFiServer wifiServer(WIFI_PORT, 1);
WiFiClient wifiPeer;
Parser wifiParser;
uint32_t wifiGeneration = 0;
char wifiIp[16]{};
bool wifiListening = false;

void pollWifi() {
    auto& port = output[static_cast<size_t>(Link::Wifi)];
    if (WiFi.status() != WL_CONNECTED) {
        if (wifiListening) {
            wifiPeer.stop();
            wifiServer.end();
            wifiListening = false;
            wifiIp[0] = 0;
        }
    } else if (!wifiListening) {
        wifiServer.begin();
        wifiServer.setNoDelay(true);
        WiFi.localIP().toString().toCharArray(wifiIp, sizeof(wifiIp));
        wifiListening = true;
    }
    if (port.connected && (!wifiListening || !wifiPeer.connected())) {
        wifiPeer.stop();
        wifiParser.reset();
        port.reconnect(false, ++wifiGeneration);
    }
    if (!wifiListening) return;

    WiFiClient candidate = wifiServer.accept();
    if (candidate) {
        const auto mask = static_cast<uint32_t>(WiFi.subnetMask());
        const auto local = static_cast<uint32_t>(WiFi.localIP());
        const auto remote = static_cast<uint32_t>(candidate.remoteIP());
        if (port.connected || !mask || (local & mask) != (remote & mask)) candidate.stop();
        else {
            wifiPeer = candidate;
            wifiParser.reset();
            port.reconnect(true, ++wifiGeneration);
        }
    }
    for (size_t i = 0; port.connected && i < 64 && wifiPeer.available(); ++i) {
        const int byte = wifiPeer.read();
        if (byte < 0) break;
        wifiParser.feed(static_cast<uint8_t>(byte), Link::Wifi, wifiGeneration);
    }
}
#endif

#ifndef PLAN_A_USB_DEMO
class ServerCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* server, NimBLEConnInfo& info) override {
        if (peerHandle.load() != 0xffff) { server->disconnect(info.getConnHandle()); return; }
        peerHandle = info.getConnHandle(); payloadBytes = std::max<uint16_t>(20, info.getMTU() - 3);
        bleParser.reset(); subscribed = false; ++bleGeneration;
    }
    void onDisconnect(NimBLEServer*, NimBLEConnInfo& info, int) override {
        if (info.getConnHandle() == peerHandle.load()) {
            subscribed = false; peerHandle = 0xffff; ++bleGeneration; bleParser.reset();
            NimBLEDevice::startAdvertising();
        }
    }
    void onMTUChange(uint16_t mtu, NimBLEConnInfo&) override {
        payloadBytes = std::max<uint16_t>(20, mtu > 3 ? mtu - 3 : 20);
    }
} serverCallbacks;
class RxCallbacks : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo& info) override {
        if (info.getConnHandle() != peerHandle.load()) return;
        const auto value = characteristic->getValue();
        for (size_t i = 0; i < value.size(); ++i)
            bleParser.feed(value.data()[i], Link::Ble, bleGeneration.load());
    }
} rxCallbacks;
class TxCallbacks : public NimBLECharacteristicCallbacks {
    void onSubscribe(NimBLECharacteristic*, NimBLEConnInfo& info, uint16_t flags) override {
        if (info.getConnHandle() == peerHandle.load()) {
            subscribed = (flags & 1) != 0; payloadBytes = std::max<uint16_t>(20, info.getMTU() - 3);
            ++bleGeneration;
        }
    }
} txCallbacks;
#endif
}

namespace transport {
void begin(const char* name) {
    commandQueue = xQueueCreate(8, sizeof(Command));
    Serial.begin(115200);
#ifndef PLAN_A_USB_DEMO
    NimBLEDevice::init(name);
    NimBLEDevice::setMTU(185);
    auto server = NimBLEDevice::createServer();
    server->setCallbacks(&serverCallbacks);
    auto service = server->createService(config::SERVICE_UUID);
    auto rx = service->createCharacteristic(config::RX_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
    tx = service->createCharacteristic(config::TX_UUID, NIMBLE_PROPERTY::NOTIFY);
    rx->setCallbacks(&rxCallbacks); tx->setCallbacks(&txCallbacks);
    server->start();
    auto advertising = NimBLEDevice::getAdvertising();
    advertising->addServiceUUID(config::SERVICE_UUID);
    advertising->setName(name);
    advertising->enableScanResponse(true);
    advertising->start();
#else
    (void)name;
#endif
#ifdef PLAN_A_WIFI
    if (WIFI_SSID[0]) {
        WiFi.persistent(false);
        WiFi.mode(WIFI_STA);
        WiFi.setAutoReconnect(true);
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
#endif
}
bool connected(Link link) { return output[static_cast<size_t>(link)].connected; }
const char* wifiAddress() {
#ifdef PLAN_A_WIFI
    return wifiIp[0] ? wifiIp : nullptr;
#else
    return nullptr;
#endif
}
bool takeConnectedEvent(Link link) {
    auto& port = output[static_cast<size_t>(link)];
    const bool event = port.event; port.event = false; return event;
}
bool nextCommand(Command& command) {
    while (xQueueReceive(commandQueue, &command, 0) == pdTRUE) {
        const auto& port = output[static_cast<size_t>(command.link)];
        if (port.connected && command.generation == port.generation) return true;
    }
    return false;
}
bool queueControl(Link link, const char* json) {
    auto& port = output[static_cast<size_t>(link)];
    return port.connected && port.control.push(json);
}
bool queueRaw(const char* json) {
    if (!connected(Link::Usb) || !raw.push(json)) { ++droppedRaw; return false; }
    return true;
}
bool queueFitness(const char* json) {
    return connected(Link::Usb) && fitness.push(json);
}
uint32_t rawDropped() { return droppedRaw; }
uint32_t commandsDropped() { return droppedCommands.load(); }
void replay(Link link) { output[static_cast<size_t>(link)].cursor = 0; }
void poll(uint64_t now, uint32_t sessionId, size_t count, size_t (*encode)(char*, size_t, size_t)) {
    const bool usb = static_cast<bool>(Serial);
    if (output[0].connected != usb) {
        output[0].reconnect(usb, ++usbGeneration); usbParser.reset(); raw.reset(); fitness.reset();
    }
#ifndef PLAN_A_USB_DEMO
    const bool ble = subscribed.load();
    if (output[1].connected != ble || output[1].generation != bleGeneration.load())
        output[1].reconnect(ble, bleGeneration.load());
#else
    (void)now;
#endif
    if (usb) {
        for (size_t i = 0; i < 64 && Serial.available(); ++i)
            usbParser.feed(static_cast<uint8_t>(Serial.read()), Link::Usb, usbGeneration);
    }
#ifdef PLAN_A_WIFI
    if (WIFI_SSID[0]) pollWifi();
#endif
    for (size_t index = 0; index < sizeof(output) / sizeof(output[0]); ++index) {
        auto& port = output[index];
        if (!port.connected) continue;
        if (port.sessionId != sessionId) { port.sessionId = sessionId; port.cursor = 0; }
        if (port.offset >= port.length) {
            port.offset = port.length = 0;
            if (port.control.pop(port.current)) port.length = std::strlen(port.current);
            else if (port.cursor < count) {
                port.length = encode(port.current, sizeof(port.current), port.cursor);
                if (port.length) ++port.cursor;
            } else if (index == 0 && (fitness.pop(port.current) || raw.pop(port.current))) {
                port.length = std::strlen(port.current);
            }
        }
        if (!port.length) continue;
        if (index == 0) {
            const int available = Serial.availableForWrite();
            if (available <= 0) continue;
            const size_t chunk = std::min<size_t>(std::min<size_t>(available, 64), port.length - port.offset);
            port.offset += Serial.write(reinterpret_cast<const uint8_t*>(port.current + port.offset), chunk);
        }
#ifndef PLAN_A_USB_DEMO
        else if (index == static_cast<size_t>(Link::Ble) && now - bleLastSend >= 10) {
            const size_t chunk = std::min<size_t>(std::min<size_t>(payloadBytes.load(), 180), port.length - port.offset);
            if (tx->notify(reinterpret_cast<const uint8_t*>(port.current + port.offset), chunk, peerHandle.load()))
                port.offset += chunk;
            bleLastSend = now;
        }
#endif
#ifdef PLAN_A_WIFI
        else if (index == static_cast<size_t>(Link::Wifi)) {
            const int sent = send(wifiPeer.fd(), port.current + port.offset, port.length - port.offset, MSG_DONTWAIT);
            if (sent > 0) port.offset += sent;
            else if (!sent || (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR)) wifiPeer.stop();
        }
#endif
    }
}
}  // namespace transport
