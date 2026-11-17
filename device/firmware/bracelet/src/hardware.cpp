#include "hardware.h"
#include "../config.h"
#include <Wire.h>
#include <algorithm>

namespace {
constexpr uint8_t OPTICAL = 0x57, IMU = 0x68;
int16_t signed16(const uint8_t* bytes) {
    return static_cast<int16_t>((static_cast<uint16_t>(bytes[0]) << 8) | bytes[1]);
}
uint32_t sample18(const uint8_t* bytes) {
    return ((static_cast<uint32_t>(bytes[0]) << 16) | (static_cast<uint32_t>(bytes[1]) << 8) | bytes[2]) & 0x3ffff;
}
}

SensorHub::SensorHub() : wire_(config::TEMPERATURE_PIN), temperature_(&wire_) {}
bool SensorHub::read(uint8_t address, uint8_t reg, uint8_t* data, size_t count) {
    Wire.beginTransmission(address);
    Wire.write(reg);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(address, count, true) != count) {
        while (Wire.available()) Wire.read();
        return false;
    }
    for (size_t i = 0; i < count; ++i) data[i] = Wire.read();
    return true;
}
bool SensorHub::write(uint8_t address, uint8_t reg, uint8_t value) {
    Wire.beginTransmission(address); Wire.write(reg); Wire.write(value);
    return Wire.endTransmission() == 0;
}
bool SensorHub::findOptical() {
    uint8_t id = 0;
    opticalOnline_ = read(OPTICAL, 0xff, &id, 1) && id == 0x15;
    // MAX30101 and MAX30102 share this ID. The purchased model selects HAS_GREEN_LED.
    if (opticalOnline_) write(OPTICAL, 0x09, 0x80);
    return opticalOnline_;
}
bool SensorHub::beginImu() {
    uint8_t id = 0;
    if (!read(IMU, 0x75, &id, 1) || (id & 0x7e) != 0x68) return false;
    const bool ok = write(IMU, 0x6b, 0x01) && write(IMU, 0x6c, 0x00) &&
                    write(IMU, 0x1a, 0x03) && write(IMU, 0x19, 19) &&
                    write(IMU, 0x1b, 0x00) && write(IMU, 0x1c, 0x00);
    motion_.reset(); imuErrors_ = 0;
    return ok;
}
void SensorHub::beginTemperature(uint64_t now) {
    temperature_.begin();
    tempOnline_ = temperature_.getAddress(temperatureAddress_, 0);
    thermal_.reset();
    if (tempOnline_) {
        temperature_.setResolution(temperatureAddress_, 12);
        temperature_.setWaitForConversion(false);
        temperature_.requestTemperatures();
        conversionAt_ = now;
    }
}
void SensorHub::begin(uint64_t now) {
    Wire.begin(config::SDA_PIN, config::SCL_PIN, config::I2C_HZ);
    Wire.setTimeOut(10);
    findOptical();
    imuOnline_ = beginImu();
    beginTemperature(now);
    retryAt_ = now;
}
void SensorHub::clearFifo() {
    write(OPTICAL, 0x04, 0); write(OPTICAL, 0x05, 0); write(OPTICAL, 0x06, 0);
}
bool SensorHub::start(device::Site site, uint64_t now) {
    if (site == device::Site::Wrist && !config::HAS_GREEN_LED) return false;
    site_ = site;
    optical_.reset(site);
    opticalErrors_ = 0;
    rawIndex_ = fifoOverflows_ = 0;
    if (!findOptical()) return false;
    // Configure while shut down. Four-sample averaging: 100/4=25 Hz finger, 400/4=100 Hz wrist.
    const bool wrist = site == device::Site::Wrist;
    bool ok = write(OPTICAL, 0x02, 0) && write(OPTICAL, 0x03, 0) &&
              write(OPTICAL, 0x08, 0x4f) && write(OPTICAL, 0x0a, wrist ? 0x2f : 0x27) &&
              write(OPTICAL, 0x0c, wrist ? 0 : config::LED_CURRENT_CODE) &&
              write(OPTICAL, 0x0d, wrist ? 0 : config::LED_CURRENT_CODE);
    if (config::HAS_GREEN_LED) {
        ok = ok && write(OPTICAL, 0x0e, wrist ? config::LED_CURRENT_CODE : 0) &&
             write(OPTICAL, 0x11, wrist ? 0x03 : 0x21) && write(OPTICAL, 0x12, 0);
    }
    clearFifo();
    uint8_t status[2];
    read(OPTICAL, 0x00, status, 2);
    ok = ok && write(OPTICAL, 0x09, wrist ? 0x07 : 0x03);
    running_ = opticalOnline_ = ok;
    opticalPollAt_ = now;
    return ok;
}
void SensorHub::stop() {
    if (opticalOnline_) write(OPTICAL, 0x09, 0x80 | (site_ == device::Site::Wrist ? 0x07 : 0x03));
    running_ = false;
}
void SensorHub::pollOptical(uint64_t now) {
    uint8_t status[2], pointers[3];
    if (!read(OPTICAL, 0x00, status, 2) || !read(OPTICAL, 0x04, pointers, 3)) {
        if (opticalErrors_ < 255) ++opticalErrors_;
        optical_.interrupt(device::Quality::SensorFault, now);
        if (opticalErrors_ >= 3) opticalOnline_ = false;
        return;
    }
    opticalErrors_ = 0;
    const uint8_t count = (pointers[0] - pointers[2]) & 0x1f;
    if (pointers[1] || (!count && (status[0] & 0x80))) {
        ++fifoOverflows_; clearFifo();
        optical_.interrupt(device::Quality::FifoOverflow, now); return;
    }
    if (status[0] & 0x20) {
        clearFifo(); optical_.interrupt(device::Quality::Saturated, now); return;
    }
    if (status[0] & 0x01) {
        // Unexpected sensor reset invalidates register configuration; terminate acquisition.
        opticalErrors_ = 3; opticalOnline_ = false;
        optical_.interrupt(device::Quality::SensorFault, now); return;
    }
    const bool wrist = site_ == device::Site::Wrist;
    const size_t frameBytes = wrist ? 3 : 6;
    const uint32_t period = wrist ? 10 : 40;
    const uint64_t backdate = count ? (count - 1) * period : 0;
    const uint64_t firstAt = now >= backdate ? now - backdate : 0;
    uint8_t bytes[18];
    for (uint8_t i = 0; i < count;) {
        const size_t frames = std::min<size_t>(count - i, sizeof(bytes) / frameBytes);
        if (!read(OPTICAL, 0x07, bytes, frames * frameBytes)) {
            ++opticalErrors_; clearFifo();
            optical_.interrupt(device::Quality::SensorFault, now); return;
        }
        for (size_t j = 0; j < frames; ++j, ++i) {
            RawSample raw;
            raw.index = rawIndex_++; raw.timeMs = firstAt + i * period; raw.site = site_;
            if (wrist) raw.green = sample18(bytes + j * frameBytes);
            else { raw.red = sample18(bytes + j * frameBytes); raw.ir = sample18(bytes + j * frameBytes + 3); }
            optical_.ingest(raw.red, raw.ir, raw.green, raw.timeMs);
            if (onRaw) onRaw(raw);
        }
    }
}
void SensorHub::poll(uint64_t now, bool capturing) {
    if (imuOnline_ && now - imuPollAt_ >= 20) {
        imuPollAt_ = now;
        uint8_t bytes[14];
        if (read(IMU, 0x3b, bytes, sizeof(bytes))) {
            imuErrors_ = 0;
            motion_.ingest(signed16(bytes) / 16384.0f, signed16(bytes + 2) / 16384.0f,
                          signed16(bytes + 4) / 16384.0f, signed16(bytes + 8) / 131.0f,
                          signed16(bytes + 10) / 131.0f, signed16(bytes + 12) / 131.0f, now);
            if (running_ && motion_.moving(now)) optical_.interrupt(device::Quality::Motion, now);
        } else if (++imuErrors_ >= 3) imuOnline_ = false;
    }
    if (running_ && now - opticalPollAt_ >= 5) {
        opticalPollAt_ = now;
        pollOptical(now);
    }
    if (tempOnline_ && now - conversionAt_ >= 1000) {
        const float c = temperature_.getTempC(temperatureAddress_);
        thermal_.ingest(c, now);
        if (c == DEVICE_DISCONNECTED_C) tempOnline_ = false;
        else { temperature_.requestTemperatures(); conversionAt_ = now; }
    }
    // Discovery can take time; only retry missing peripherals outside acquisition.
    if (!capturing && now - retryAt_ >= 5000) {
        retryAt_ = now;
        if (!running_ && !opticalOnline_) findOptical();
        if (!imuOnline_) imuOnline_ = beginImu();
        if (!tempOnline_) beginTemperature(now);
    }
}
device::Reading SensorHub::reading(uint64_t now) {
    device::Reading result;
    optical_.evaluate(motion_.available(now), motion_.moving(now), config::ENABLE_EXPERIMENTAL_SPO2,
                      now, result.pulse, result.spo2);
    result.temperature = thermal_.reading(now);
    result.motion = motion_.acceleration(now);
    result.gyro = motion_.rotation(now);
    result.contact = optical_.contact();
    return result;
}
