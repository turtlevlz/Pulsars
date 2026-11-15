#include "device_core.h"
#include "../config.h"
#include "spo2_algorithm.h"
#include <algorithm>

namespace device {
const char* name(Site x) { return x == Site::Finger ? "finger" : "wrist"; }
const char* name(Quality x) {
    switch (x) {
        case Quality::Ok: return "ok";
        case Quality::Warming: return "warming";
        case Quality::NoContact: return "no_contact";
        case Quality::Motion: return "motion";
        case Quality::PoorSignal: return "poor_signal";
        case Quality::InsufficientData: return "insufficient_data";
        case Quality::SensorFault: return "sensor_fault";
        case Quality::Saturated: return "saturated";
        case Quality::FifoOverflow: return "fifo_overflow";
        case Quality::MotionUnavailable: return "motion_unavailable";
        case Quality::Disabled: return "disabled";
        case Quality::Unsupported: return "unsupported";
    }
    return "sensor_fault";
}
const char* name(State x) {
    switch (x) {
        case State::Idle: return "idle";
        case State::Stabilizing: return "stabilizing";
        case State::Recording: return "recording";
        case State::Complete: return "complete";
        case State::InsufficientSignal: return "insufficient_signal";
        case State::Cancelled: return "cancelled";
        case State::Fault: return "fault";
    }
    return "fault";
}
const char* name(FrameType x) {
    switch (x) {
        case FrameType::Start: return "session_start";
        case FrameType::StateChange: return "session_state";
        case FrameType::Reading: return "reading";
        case FrameType::End: return "session_end";
    }
    return "session_end";
}
bool Session::active() const { return state_ == State::Stabilizing || state_ == State::Recording; }
bool Session::start(uint64_t now, Site site) {
    if (active() || pending_) return false;
    ++id_;
    count_ = 0;
    nextSecond_ = 1;
    validPulseSeconds_ = observedRecordingSeconds_ = 0;
    startedAt_ = now;
    site_ = site;
    pending_ = true;
    reason_ = "none";
    state_ = State::Stabilizing;
    append(FrameType::Start, now);
    return true;
}
bool Session::startWhenReady(uint64_t now, Site site, const Reading& reading) {
    return reading.contact && reading.pulse.valid() && start(now, site);
}
void Session::append(FrameType type, uint64_t now, const Reading& reading) {
    if (count_ >= MAX_FRAMES) return;
    frames_[count_] = {type, state_, static_cast<uint32_t>(count_),
                      static_cast<uint32_t>(now - startedAt_), now, reading};
    ++count_;
}
void Session::finish(uint64_t now, State result, const char* reason) {
    state_ = result;
    reason_ = reason;
    append(FrameType::End, now);
}
void Session::tick(uint64_t now, const Reading& input) {
    if (!active()) return;
    const uint64_t elapsed = now - startedAt_;
    if (elapsed >= DEADLINE_MS) { finish(now, State::Fault, "deadline_exceeded"); return; }
    if (elapsed >= STABILIZE_MS + RECORD_MS) {
        finish(now, validPulseSeconds_ >= 48 ? State::Complete : State::InsufficientSignal,
               validPulseSeconds_ >= 48 ? "recording_finished" : "pulse_coverage_below_80_percent");
        return;
    }
    if (count_ >= MAX_FRAMES - 2) { finish(now, State::Fault, "session_buffer_full"); return; }
    if (state_ == State::Stabilizing && elapsed >= STABILIZE_MS) {
        state_ = State::Recording;
        append(FrameType::StateChange, now);
    }
    const auto second = static_cast<uint32_t>(elapsed / 1000);
    if (second < nextSecond_) return;
    // Never backfill missed seconds with repeated values.
    nextSecond_ = second + 1;
    Reading reading = input;
    if (state_ == State::Recording) {
        ++observedRecordingSeconds_;
        if (reading.pulse.valid()) ++validPulseSeconds_;
    } else if (reading.pulse.valid()) {
        reading.pulse = {NAN, Quality::Warming};
        if (reading.spo2.valid()) reading.spo2 = {NAN, Quality::Warming};
    }
    append(FrameType::Reading, now, reading);
}
void Session::cancel(uint64_t now) { if (active()) finish(now, State::Cancelled, "button_or_command"); }
void Session::fail(uint64_t now, const char* reason) { if (active()) finish(now, State::Fault, reason); }
bool Session::acknowledge(uint32_t id, uint32_t seq) {
    if (active() || !count_ || id != id_ || seq != frames_[count_ - 1].seq ||
        frames_[count_ - 1].type != FrameType::End) return false;
    pending_ = false;
    return true;
}

void MotionMonitor::reset() { *this = MotionMonitor{}; }
void MotionMonitor::ingest(float ax, float ay, float az, float gx, float gy, float gz, uint64_t now) {
    const float a[] = {ax, ay, az};
    if (!std::isfinite(ax + ay + az + gx + gy + gz)) return;
    if (!samples_) std::copy(a, a + 3, baseline_);
    float dynamicPower = 0;
    for (size_t i = 0; i < 3; ++i) {
        baseline_[i] += 0.02f * (a[i] - baseline_[i]);
        const float d = a[i] - baseline_[i];
        dynamicPower += d * d;
    }
    accPower_ += 0.04f * (dynamicPower - accPower_);
    gyroPower_ += 0.04f * (gx * gx + gy * gy + gz * gz - gyroPower_);
    if (samples_ < 1000) ++samples_;
    lastAt_ = now;
}
bool MotionMonitor::available(uint64_t now) const { return samples_ >= 25 && now - lastAt_ <= 200; }
bool MotionMonitor::moving(uint64_t now) const {
    return available(now) && (std::sqrt(accPower_) > config::MOTION_RMS_G ||
                              std::sqrt(gyroPower_) > config::MOTION_GYRO_DPS);
}
Metric MotionMonitor::acceleration(uint64_t now) const {
    return available(now) ? Metric{std::sqrt(std::max(0.0f, accPower_)), Quality::Ok}
                          : Metric{NAN, Quality::SensorFault};
}
Metric MotionMonitor::rotation(uint64_t now) const {
    return available(now) ? Metric{std::sqrt(std::max(0.0f, gyroPower_)), Quality::Ok}
                          : Metric{NAN, Quality::SensorFault};
}

void TemperatureMonitor::reset() { *this = TemperatureMonitor{}; }
void TemperatureMonitor::fault() { fault_ = true; count_ = head_ = 0; }
void TemperatureMonitor::ingest(float c, uint64_t now) {
    // Reject library disconnect sentinels, power-up 85 C, and impossible sensor values.
    if (!std::isfinite(c) || c < -55 || c > 125 || c == 85.0f) { fault(); return; }
    fault_ = false;
    latest_ = c;
    lastAt_ = now;
    history_[head_] = c;
    head_ = (head_ + 1) % history_.size();
    count_ = std::min(count_ + 1, history_.size());
}
Metric TemperatureMonitor::reading(uint64_t now) const {
    if (fault_ || now - lastAt_ > 2500) return {NAN, Quality::SensorFault};
    if (count_ < history_.size()) return {NAN, Quality::Warming};
    const auto range = std::minmax_element(history_.begin(), history_.end());
    if (*range.second - *range.first > config::TEMPERATURE_SETTLED_RANGE_C)
        return {NAN, Quality::Warming};
    return {latest_, Quality::Ok};
}

void OpticalProcessor::clearWindow() {
    count_ = head_ = 0;
    filterReady_ = false;
    highPass_ = lowPass_ = 0;
}
void OpticalProcessor::reset(Site site) {
    *this = OpticalProcessor{};
    site_ = site;
}
void OpticalProcessor::interrupt(Quality reason, uint64_t now) {
    clearWindow();
    error_ = reason;
    errorUntil_ = now + 1100;
    if (reason == Quality::SensorFault || reason == Quality::NoContact) contact_ = false;
}
void OpticalProcessor::ingest(uint32_t red, uint32_t ir, uint32_t green, uint64_t now) {
    const uint32_t sample = site_ == Site::Wrist ? green : ir;
    lastAt_ = now;
    contact_ = sample >= config::CONTACT_MIN_COUNTS;
    if (!contact_) { interrupt(Quality::NoContact, now); return; }
    if (sample >= config::SATURATION_COUNTS ||
        (site_ == Site::Finger && red >= config::SATURATION_COUNTS)) {
        interrupt(Quality::Saturated, now); return;
    }
    if (site_ == Site::Finger) {
        red_[head_] = red;
        ir_[head_] = ir;
        head_ = (head_ + 1) % ir_.size();
        count_ = std::min(count_ + 1, ir_.size());
        return;
    }
    const float raw = static_cast<float>(sample);
    if (!filterReady_) { previousRaw_ = dc_ = raw; filterReady_ = true; }
    dc_ += 0.01f * (raw - dc_);
    highPass_ = 0.969f * (highPass_ + raw - previousRaw_);
    previousRaw_ = raw;
    lowPass_ += 0.24f * (highPass_ - lowPass_);
    green_[head_] = lowPass_;
    head_ = (head_ + 1) % green_.size();
    count_ = std::min(count_ + 1, green_.size());
}
Metric OpticalProcessor::wristPulse(const float* samples, size_t count, float dc) {
    if (count < 600) return {NAN, Quality::Warming};
    float mean = 0, power = 0;
    for (size_t i = 0; i < count; ++i) mean += samples[i];
    mean /= static_cast<float>(count);
    for (size_t i = 0; i < count; ++i) power += (samples[i] - mean) * (samples[i] - mean);
    if (dc <= 0 || std::sqrt(power / count) / dc < config::MIN_AC_DC_RATIO)
        return {NAN, Quality::PoorSignal};
    std::array<float, 203> correlation{};
    for (size_t lag = 26; lag <= 201; ++lag) {
        double cross = 0, left = 0, right = 0;
        for (size_t i = lag; i < count; ++i) {
            const double a = samples[i] - mean, b = samples[i - lag] - mean;
            cross += a * b; left += a * a; right += b * b;
        }
        correlation[lag] = left * right > 0 ? static_cast<float>(cross / std::sqrt(left * right)) : 0;
    }
    float best = 0;
    for (size_t lag = 28; lag <= 200; ++lag)
        if (correlation[lag] >= correlation[lag - 1] && correlation[lag] > correlation[lag + 1])
            best = std::max(best, correlation[lag]);
    if (best < 0.70f) return {NAN, Quality::PoorSignal};
    // Prefer the first strong peak to avoid selecting a multiple of the beat period.
    for (size_t lag = 28; lag <= 200; ++lag) {
        if (correlation[lag] >= std::max(0.70f, best - 0.05f) &&
            correlation[lag] >= correlation[lag - 1] && correlation[lag] > correlation[lag + 1]) {
            const float denominator = correlation[lag - 1] - 2 * correlation[lag] + correlation[lag + 1];
            const float delta = std::abs(denominator) > 1e-6f
                ? 0.5f * (correlation[lag - 1] - correlation[lag + 1]) / denominator : 0;
            return {6000.0f / (static_cast<float>(lag) + std::clamp(delta, -0.5f, 0.5f)), Quality::Ok};
        }
    }
    return {NAN, Quality::PoorSignal};
}
void OpticalProcessor::evaluate(bool motionAvailable, bool moving, bool enabled, uint64_t now,
                                Metric& pulse, Metric& spo2) {
    spo2 = {NAN, site_ == Site::Wrist ? Quality::Unsupported : Quality::Disabled};
    Quality reason = Quality::Ok;
    if (!lastAt_ || now - lastAt_ > 300) reason = Quality::SensorFault;
    else if (!contact_) reason = Quality::NoContact;
    else if (!motionAvailable) reason = Quality::MotionUnavailable;
    else if (moving) reason = Quality::Motion;
    else if (now < errorUntil_) reason = error_;
    if (reason != Quality::Ok) {
        pulse = {NAN, reason};
        if (enabled && site_ == Site::Finger) spo2 = pulse;
        if (moving || !motionAvailable) clearWindow();
        return;
    }
    if (site_ == Site::Wrist) {
        if (count_ < green_.size()) { pulse = {NAN, Quality::Warming}; return; }
        std::array<float, 600> ordered{};
        for (size_t i = 0; i < ordered.size(); ++i) ordered[i] = green_[(head_ + i) % green_.size()];
        pulse = wristPulse(ordered.data(), ordered.size(), dc_);
        return;
    }
    if (count_ < ir_.size()) {
        pulse = {NAN, Quality::Warming};
        if (enabled) spo2 = pulse;
        return;
    }
    uint32_t ir[100], red[100];
    double mean = 0, variance = 0;
    for (size_t i = 0; i < 100; ++i) {
        ir[i] = ir_[(head_ + i) % 100]; red[i] = red_[(head_ + i) % 100]; mean += ir[i];
    }
    mean /= 100;
    for (auto sample : ir) variance += (sample - mean) * (sample - mean);
    if (mean <= 0 || std::sqrt(variance / 100) / mean < config::MIN_AC_DC_RATIO) {
        pulse = {NAN, Quality::PoorSignal}; if (enabled) spo2 = pulse; return;
    }
    int32_t oxygen = 0, heartRate = 0;
    int8_t oxygenValid = 0, pulseValid = 0;
    maxim_heart_rate_and_oxygen_saturation(ir, 100, red, &oxygen, &oxygenValid, &heartRate, &pulseValid);
    pulse = pulseValid && heartRate >= 30 && heartRate <= 220
        ? Metric{static_cast<float>(heartRate), Quality::Ok} : Metric{NAN, Quality::PoorSignal};
    if (enabled) spo2 = oxygenValid && pulse.valid() && oxygen > 0 && oxygen <= 100
        ? Metric{static_cast<float>(oxygen), Quality::Ok} : Metric{NAN, Quality::PoorSignal};
}
}  // namespace device
