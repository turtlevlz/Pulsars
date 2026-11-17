#pragma once
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace device {
enum class Site { Finger, Wrist };
enum class Quality { Ok, Warming, NoContact, Motion, PoorSignal, InsufficientData,
                     SensorFault, Saturated, FifoOverflow, MotionUnavailable, Disabled, Unsupported };
enum class State { Idle, Stabilizing, Recording, Complete, InsufficientSignal, Cancelled, Fault };
enum class FrameType { Start, StateChange, Reading, End };
const char* name(Site site);
const char* name(Quality quality);
const char* name(State state);
const char* name(FrameType type);

struct Metric {
    float value = NAN;
    Quality quality = Quality::InsufficientData;
    bool valid() const { return quality == Quality::Ok && std::isfinite(value); }
};
struct Reading {
    Metric pulse, spo2, temperature, motion, gyro;
    bool contact = false;
};
struct Frame {
    FrameType type = FrameType::Reading;
    State state = State::Idle;
    uint32_t seq = 0;
    uint32_t elapsedMs = 0;
    uint64_t deviceTimeMs = 0;
    Reading reading;
};

class UsbCaptureGate {
public:
    void noteStatus(uint64_t now) { readyUntil_ = now + 15000; }
    bool ready(uint64_t now, bool connected) const { return connected && now < readyUntil_; }
private:
    uint64_t readyUntil_ = 0;
};

class Session {
public:
    static constexpr uint32_t STABILIZE_MS = 15000;
    static constexpr uint32_t RECORD_MS = 60000;
    static constexpr uint32_t DEADLINE_MS = 90000;
    static constexpr size_t MAX_FRAMES = 96;
    bool start(uint64_t now, Site site);
    bool startWhenReady(uint64_t now, Site site, const Reading& reading);
    void tick(uint64_t now, const Reading& reading);
    void cancel(uint64_t now);
    void fail(uint64_t now, const char* reason);
    bool acknowledge(uint32_t sessionId, uint32_t lastSeq);
    bool active() const;
    bool pending() const { return pending_; }
    State state() const { return state_; }
    Site site() const { return site_; }
    uint32_t id() const { return id_; }
    size_t size() const { return count_; }
    const Frame& frame(size_t index) const { return frames_[index]; }
    uint32_t validPulseSeconds() const { return validPulseSeconds_; }
    uint32_t observedRecordingSeconds() const { return observedRecordingSeconds_; }
    const char* reason() const { return reason_; }
    uint64_t startedAt() const { return startedAt_; }
private:
    void append(FrameType type, uint64_t now, const Reading& reading = {});
    void finish(uint64_t now, State result, const char* reason);
    std::array<Frame, MAX_FRAMES> frames_{};
    size_t count_ = 0;
    uint32_t id_ = 0, nextSecond_ = 1, validPulseSeconds_ = 0, observedRecordingSeconds_ = 0;
    uint64_t startedAt_ = 0;
    State state_ = State::Idle;
    Site site_ = Site::Finger;
    bool pending_ = false;
    const char* reason_ = "none";
};

class MotionMonitor {
public:
    void reset();
    void ingest(float ax, float ay, float az, float gx, float gy, float gz, uint64_t now);
    bool available(uint64_t now) const;
    bool moving(uint64_t now) const;
    Metric acceleration(uint64_t now) const;
    Metric rotation(uint64_t now) const;
private:
    float baseline_[3] = {}, accPower_ = 0, gyroPower_ = 0;
    uint32_t samples_ = 0;
    uint64_t lastAt_ = 0;
};

class TemperatureMonitor {
public:
    void reset();
    void ingest(float celsius, uint64_t now);
    void fault();
    Metric reading(uint64_t now) const;
private:
    std::array<float, 30> history_{};
    size_t count_ = 0, head_ = 0;
    uint64_t lastAt_ = 0;
    float latest_ = NAN;
    bool fault_ = true;
};

class OpticalProcessor {
public:
    void reset(Site site);
    void interrupt(Quality reason, uint64_t now);
    void ingest(uint32_t red, uint32_t ir, uint32_t green, uint64_t now);
    void evaluate(bool motionAvailable, bool moving, bool spo2Enabled, uint64_t now,
                  Metric& pulse, Metric& spo2);
    bool contact() const { return contact_; }
    static Metric wristPulse(const float* samples, size_t count, float dc);
private:
    void clearWindow();
    Site site_ = Site::Finger;
    std::array<uint32_t, 100> red_{}, ir_{};
    std::array<float, 600> green_{};
    size_t head_ = 0, count_ = 0;
    uint64_t lastAt_ = 0, errorUntil_ = 0;
    Quality error_ = Quality::Warming;
    bool contact_ = false, filterReady_ = false;
    float previousRaw_ = 0, highPass_ = 0, lowPass_ = 0, dc_ = 0;
};
}  // namespace device
