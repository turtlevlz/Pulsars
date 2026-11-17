#include "protocol.h"
#include "transport.h"
#include "../config.h"
#include <ArduinoJson.h>

namespace {
void envelope(JsonDocument& doc, const Identity& id, const char* type) {
    doc["v"] = 1; doc["type"] = type; doc["source"] = "device";
    doc["device_id"] = id.deviceId; doc["boot_id"] = id.bootId;
}
size_t finish(JsonDocument& doc, char* out, size_t capacity) {
    const size_t needed = measureJson(doc);
    if (doc.overflowed() || needed + 2 > capacity) { out[0] = 0; return 0; }
    const size_t length = serializeJson(doc, out, capacity);
    out[length] = '\n'; out[length + 1] = 0;
    return length + 1;
}
void value(JsonObject target, const char* key, const device::Metric& metric) {
    if (metric.valid()) target[key] = metric.value;
    else target[key] = nullptr;
}
void settings(JsonObject object, device::Site site) {
    object["optical_sensor"] = config::HAS_GREEN_LED ? "MAX30101" : "MAX30102";
    object["effective_sample_hz"] = site == device::Site::Wrist ? 100 : 25;
    object["hardware_sample_hz"] = site == device::Site::Wrist ? 400 : 100;
    object["sample_average"] = 4;
    object["led_current_code"] = config::LED_CURRENT_CODE;
    object["pulse_width_us"] = 411;
    object["adc_range_na"] = 4096;
    object["spo2_enabled"] = config::ENABLE_EXPERIMENTAL_SPO2;
    object["spo2_experimental"] = true;
    if (config::AUTOMATIC_CAPTURE) object["automatic_capture"] = true;
    object["stabilize_ms"] = device::Session::STABILIZE_MS;
    object["record_ms"] = device::Session::RECORD_MS;
}
}
size_t encodeFrame(char* out, size_t capacity, const Identity& id, const device::Session& session, size_t index) {
    if (index >= session.size()) return 0;
    const auto& f = session.frame(index);
    JsonDocument doc;
    envelope(doc, id, device::name(f.type));
    doc["session_id"] = session.id(); doc["seq"] = f.seq;
    doc["device_time_ms"] = f.deviceTimeMs; doc["elapsed_ms"] = f.elapsedMs;
    doc["optical_site"] = device::name(session.site());
    doc["state"] = device::name(f.state);
    if (f.type == device::FrameType::Start) {
        doc["firmware_version"] = config::FIRMWARE_VERSION;
        settings(doc["settings"].to<JsonObject>(), session.site());
    } else if (f.type == device::FrameType::Reading) {
        auto values = doc["values"].to<JsonObject>();
        value(values, "pulse_bpm", f.reading.pulse);
        value(values, "spo2_pct", f.reading.spo2);
        value(values, "skin_temp_c", f.reading.temperature);
        value(values, "motion_rms_g", f.reading.motion);
        value(values, "gyro_rms_dps", f.reading.gyro);
        auto quality = doc["quality"].to<JsonObject>();
        quality["pulse"] = device::name(f.reading.pulse.quality);
        quality["spo2"] = device::name(f.reading.spo2.quality);
        quality["skin_temp"] = device::name(f.reading.temperature.quality);
        quality["motion"] = device::name(f.reading.motion.quality);
        doc["contact_estimated"] = f.reading.contact;
    } else if (f.type == device::FrameType::End) {
        doc["reason"] = session.reason();
        doc["frame_count"] = session.size();
        doc["expected_recording_readings"] = device::Session::RECORD_MS / 1000;
        doc["observed_recording_readings"] = session.observedRecordingSeconds();
        doc["valid_pulse_readings"] = session.validPulseSeconds();
    }
    return finish(doc, out, capacity);
}
size_t encodeFitnessWindow(char* out, size_t capacity, const Identity& id, uint64_t start,
                           const device::FitnessCapture::Samples& samples) {
    JsonDocument doc;
    envelope(doc, id, "fitness_window");
    doc["device_time_ms"] = start;
    auto slots = doc["samples"].to<JsonArray>();
    for (const auto& sample : samples) {
        if (!sample) {
            slots.add(nullptr);
            continue;
        }
        auto values = slots.add<JsonObject>();
        value(values, "motion_rms_g", sample->motion);
        value(values, "gyro_rms_dps", sample->gyro);
        value(values, "pulse_bpm", sample->pulse);
        value(values, "skin_temp_c", sample->temperature);
    }
    return finish(doc, out, capacity);
}

size_t encodeHello(char* out, size_t capacity, const Identity& id, const device::Session& session,
                   device::Site site, const SensorHub& sensors, uint64_t now, uint32_t rawDropped) {
    JsonDocument doc;
    envelope(doc, id, "hello");
    doc["firmware_version"] = config::FIRMWARE_VERSION;
    doc["device_time_ms"] = now;
    doc["state"] = device::name(session.state());
    doc["configured_site"] = device::name(site);
    doc["pending_ack"] = session.pending();
    if (const char* address = transport::wifiAddress()) doc["wifi_ipv4"] = address;
    if (session.size()) { doc["buffered_session_id"] = session.id(); doc["last_seq"] = session.size() - 1; }
    else { doc["buffered_session_id"] = nullptr; doc["last_seq"] = nullptr; }
    auto caps = doc["capabilities"].to<JsonObject>();
    caps["finger_pulse"] = true; caps["wrist_pulse_trial"] = config::ALLOW_WRIST_TRIAL;
    caps["skin_temperature"] = true; caps["motion"] = true;
    caps["spo2_enabled"] = config::ENABLE_EXPERIMENTAL_SPO2;
    caps["raw_usb"] = true;
    if (config::USB_DEMO) {
        caps["usb_demo"] = true;
        caps["fitness_stream"] = true;
    }
    if (config::AUTOMATIC_CAPTURE) caps["automatic_capture"] = true;
    auto present = doc["sensors_present"].to<JsonObject>();
    present["optical"] = sensors.opticalAvailable(); present["imu"] = sensors.imuAvailable();
    present["temperature"] = sensors.temperatureAvailable();
    doc["fifo_overflows"] = sensors.fifoOverflows(); doc["raw_packets_dropped"] = rawDropped;
    return finish(doc, out, capacity);
}
size_t encodeReply(char* out, size_t capacity, const Identity& id, const char* commandId,
                   bool ok, const char* error) {
    JsonDocument doc;
    envelope(doc, id, "reply");
    if (commandId) doc["command_id"] = commandId; else doc["command_id"] = nullptr;
    doc["ok"] = ok;
    if (error) doc["error"] = error; else doc["error"] = nullptr;
    return finish(doc, out, capacity);
}
size_t encodeRaw(char* out, size_t capacity, const Identity& id, const RawSample& s,
                 uint32_t sessionId, uint32_t fifoOverflows) {
    JsonDocument doc;
    envelope(doc, id, "raw");
    doc["session_id"] = sessionId; doc["sample_index"] = s.index;
    doc["device_time_ms"] = s.timeMs; doc["optical_site"] = device::name(s.site);
    doc["effective_sample_hz"] = s.site == device::Site::Wrist ? 100 : 25;
    if (s.site == device::Site::Wrist) { doc["green"] = s.green; doc["red"] = nullptr; doc["ir"] = nullptr; }
    else { doc["green"] = nullptr; doc["red"] = s.red; doc["ir"] = s.ir; }
    doc["fifo_overflows"] = fifoOverflows;
    return finish(doc, out, capacity);
}
