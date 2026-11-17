#pragma once
#include "device_core.h"
#include <DallasTemperature.h>
#include <OneWire.h>

struct RawSample {
    uint32_t index = 0, red = 0, ir = 0, green = 0;
    uint64_t timeMs = 0;
    device::Site site = device::Site::Finger;
};

class SensorHub {
public:
    SensorHub();
    void begin(uint64_t now);
    bool start(device::Site site, uint64_t now);
    void stop();
    void poll(uint64_t now, bool capturing);
    device::Reading reading(uint64_t now);
    bool opticalAvailable() const { return opticalOnline_; }
    bool imuAvailable() const { return imuOnline_; }
    bool temperatureAvailable() const { return tempOnline_; }
    bool opticalRunning() const { return running_; }
    bool opticalFailed() const { return running_ && opticalErrors_ >= 3; }
    uint32_t fifoOverflows() const { return fifoOverflows_; }
    void (*onRaw)(const RawSample&) = nullptr;
private:
    bool read(uint8_t address, uint8_t reg, uint8_t* data, size_t count);
    bool write(uint8_t address, uint8_t reg, uint8_t value);
    bool findOptical();
    bool beginImu();
    void beginTemperature(uint64_t now);
    void pollOptical(uint64_t now);
    void clearFifo();
    OneWire wire_;
    DallasTemperature temperature_;
    DeviceAddress temperatureAddress_{};
    device::OpticalProcessor optical_;
    device::MotionMonitor motion_;
    device::TemperatureMonitor thermal_;
    device::Site site_ = device::Site::Finger;
    uint64_t opticalPollAt_ = 0, imuPollAt_ = 0, conversionAt_ = 0, retryAt_ = 0;
    uint32_t rawIndex_ = 0, fifoOverflows_ = 0;
    uint8_t opticalErrors_ = 0, imuErrors_ = 0;
    bool running_ = false, opticalOnline_ = false, imuOnline_ = false, tempOnline_ = false;
};
