#include "../firmware/bracelet/src/device_core.h"
#include "../firmware/bracelet/config.h"
#include "../firmware/bracelet/src/spo2_algorithm.h"
#include <cassert>
#include <cmath>
#include <iostream>
#include <random>

device::Reading good() {
    device::Reading reading;
    reading.pulse = {72, device::Quality::Ok};
    reading.spo2 = {NAN, device::Quality::Disabled};
    reading.temperature = {33, device::Quality::Ok};
    reading.motion = reading.gyro = {0, device::Quality::Ok};
    reading.contact = true;
    return reading;
}

int main() {
    using namespace device;
#ifdef PLAN_A_COMPETITION
    static_assert(config::AUTOMATIC_CAPTURE && config::ENABLE_EXPERIMENTAL_SPO2);
    static_assert(!config::ALLOW_WRIST_TRIAL);
#endif
#ifdef PLAN_A_USB_DEMO
    static_assert(config::USB_DEMO);
    UsbCaptureGate host;
    assert(!host.ready(100, true));
    host.noteStatus(100);
    assert(host.ready(100, true));
    assert(!host.ready(100, false));
    assert(!host.ready(15100, true));
    host.noteStatus(16000);
    assert(host.ready(16001, true));
#endif
    Session passive;
    Reading contact = good();
    contact.contact = false;
    assert(!passive.startWhenReady(1000, Site::Finger, contact));
    contact.contact = true;
    contact.pulse = {NAN, Quality::Motion};
    assert(!passive.startWhenReady(2000, Site::Finger, contact));
    contact.pulse = {NAN, Quality::Warming};
    assert(!passive.startWhenReady(3000, Site::Finger, contact));
    contact.pulse = {72, Quality::Ok};
    contact.spo2 = {98, Quality::Ok};
    assert(passive.startWhenReady(4000, Site::Finger, contact));
    assert(!passive.startWhenReady(5000, Site::Finger, contact));
    for (uint64_t t = 5000; t <= 79000; t += 1000) passive.tick(t, contact);
    assert(passive.state() == State::Complete && passive.validPulseSeconds() == 60);
    assert(passive.frame(1).reading.spo2.quality == Quality::Warming);
    assert(passive.frame(16).reading.spo2.valid());
    assert(!passive.startWhenReady(80000, Site::Finger, contact));
    assert(passive.acknowledge(passive.id(), passive.size() - 1));
    contact.contact = false;
    assert(!passive.startWhenReady(81000, Site::Finger, contact));
    assert(passive.id() == 1);
    assert(passive.startWhenReady(82000, Site::Finger, good()));
    assert(passive.id() == 2);

    Session session;
    assert(session.start(1000, Site::Finger));
    assert(!session.start(1001, Site::Wrist));
    for (uint64_t t = 2000; t <= 76000; t += 1000) session.tick(t, good());
    assert(session.state() == State::Complete);
    assert(session.validPulseSeconds() == 60);
    assert(session.observedRecordingSeconds() == 60);
    assert(session.size() == 77);
    assert(!session.acknowledge(session.id(), 1));
    assert(!session.start(77000, Site::Finger));
    assert(session.acknowledge(session.id(), session.size() - 1));
    assert(session.acknowledge(session.id(), session.size() - 1));
    assert(session.start(80000, Site::Wrist));
    session.cancel(81000);
    assert(session.state() == State::Cancelled);
    assert(session.frame(session.size() - 1).type == FrameType::End);

    Session sparse;
    assert(sparse.start(0, Site::Finger));
    sparse.tick(15000, good()); sparse.tick(74000, good()); sparse.tick(75000, good());
    assert(sparse.state() == State::InsufficientSignal);
    assert(sparse.validPulseSeconds() == 2);
    Session deadline;
    deadline.start(0, Site::Finger); deadline.tick(91000, good());
    assert(deadline.state() == State::Fault);
    Session fault;
    fault.start(0, Site::Finger); fault.fail(10, "missing_sensor");
    assert(fault.state() == State::Fault && fault.size() == 2);
    Session boot;
    assert(!boot.pending() && boot.size() == 0);

    for (int valid : {47, 48}) {
        Session boundary;
        boundary.start(0, Site::Finger);
        for (uint64_t t = 1000; t <= 75000; t += 1000) {
            Reading value = good();
            if (t >= 15000 + static_cast<uint64_t>(valid) * 1000) value.pulse = {NAN, Quality::PoorSignal};
            boundary.tick(t, value);
        }
        assert(boundary.state() == (valid == 48 ? State::Complete : State::InsufficientSignal));
    }

    TemperatureMonitor temperature;
    assert(temperature.reading(0).quality == Quality::SensorFault);
    temperature.ingest(85, 0);
    assert(temperature.reading(0).quality == Quality::SensorFault);
    for (uint64_t i = 0; i < 29; ++i) temperature.ingest(33.0f, i * 1000);
    assert(temperature.reading(28000).quality == Quality::Warming);
    temperature.ingest(33.0f, 29000);
    assert(temperature.reading(29000).valid());
    assert(temperature.reading(32000).quality == Quality::SensorFault);
    temperature.ingest(34, 30000);
    assert(temperature.reading(30000).quality == Quality::Warming);
    temperature.ingest(-127, 31000);
    assert(temperature.reading(31000).quality == Quality::SensorFault);

    for (float gravity : {0.0f, 1.0f}) {
        MotionMonitor motion;
        for (uint64_t i = 0; i < 100; ++i) motion.ingest(0, 0, gravity, 0, 0, 0, i * 20);
        assert(motion.available(2000) && !motion.moving(2000));
        for (uint64_t i = 100; i < 150; ++i) motion.ingest(i % 2 ? 0.3f : -0.3f, 0, gravity, 0, 0, 60, i * 20);
        assert(motion.moving(3000));
        assert(!motion.available(4000));
    }

    constexpr float PI = 3.14159265358979323846f;
    for (float bpm : {45.0f, 60.0f, 72.0f, 90.0f, 120.0f, 180.0f}) {
        OpticalProcessor optical;
        optical.reset(Site::Wrist);
        for (uint64_t i = 0; i < 1000; ++i)
            optical.ingest(0, 0, static_cast<uint32_t>(60000 + 1200 * std::sin(2 * PI * bpm / 60 * i / 100)), 1000 + i * 10);
        Metric pulse, oxygen;
        optical.evaluate(true, false, false, 10990, pulse, oxygen);
        assert(pulse.valid() && std::abs(pulse.value - bpm) < 2.0f);
        assert(oxygen.quality == Quality::Unsupported);
        optical.interrupt(Quality::FifoOverflow, 11000);
        optical.evaluate(true, false, false, 11000, pulse, oxygen);
        assert(pulse.quality == Quality::FifoOverflow);
        optical.ingest(0, 0, 0, 11010);
        optical.evaluate(true, false, false, 11010, pulse, oxygen);
        assert(pulse.quality == Quality::NoContact && !pulse.valid());
    }
    OpticalProcessor finger;
    finger.reset(Site::Finger);
    for (uint64_t i = 0; i < 200; ++i) {
        const float wave = std::sin(2 * PI * 1.2f * i / 25);
        finger.ingest(static_cast<uint32_t>(50000 + 600 * wave), static_cast<uint32_t>(60000 + 1200 * wave), 0, 1000 + i * 40);
    }
    Metric pulse, oxygen;
    finger.evaluate(true, false, false, 8960, pulse, oxygen);
    assert(pulse.valid() && std::abs(pulse.value - 72) <= 4);
    assert(oxygen.quality == Quality::Disabled);
    finger.evaluate(true, false, true, 8960, pulse, oxygen);
    assert(pulse.valid() && oxygen.valid() && oxygen.value > 0 && oxygen.value <= 100);
    finger.evaluate(true, true, true, 8960, pulse, oxygen);
    assert(pulse.quality == Quality::Motion && oxygen.quality == Quality::Motion && !oxygen.valid());
    finger.ingest(262143, 262143, 0, 9000);
    finger.evaluate(true, false, true, 9000, pulse, oxygen);
    assert(pulse.quality == Quality::Saturated && oxygen.quality == Quality::Saturated && !oxygen.valid());
    finger.evaluate(false, false, false, 9000, pulse, oxygen);
    assert(pulse.quality == Quality::MotionUnavailable);
    finger.evaluate(true, false, false, 9500, pulse, oxygen);
    assert(pulse.quality == Quality::SensorFault);
    finger.ingest(0, 0, 0, 9600);
    finger.evaluate(true, false, true, 9600, pulse, oxygen);
    assert(pulse.quality == Quality::NoContact && oxygen.quality == Quality::NoContact && !oxygen.valid());

    std::mt19937 generator(2026);
    std::normal_distribution<float> noise(0, 1000);
    float random[600];
    for (auto& sample : random) sample = noise(generator);
    assert(!OpticalProcessor::wristPulse(random, 600, 60000).valid());
    float flat[600]{};
    assert(!OpticalProcessor::wristPulse(flat, 600, 60000).valid());

    int32_t locations[15]{}, peak_count = 0;
    int32_t trailing_plateau[]{0, 10, 10, 10};
    maxim_peaks_above_min_height(locations, &peak_count, trailing_plateau, 4, 5);
    assert(peak_count == 0);
    int32_t closed_plateau[]{0, 10, 10, 0};
    maxim_peaks_above_min_height(locations, &peak_count, closed_plateau, 4, 5);
    assert(peak_count == 1 && locations[0] == 1);
    std::cout << "PASS: session lifecycle, buffering/ACK, coverage, cancellation, faults, timing, temperature, motion, optical quality, synthetic pulse processing, peak-buffer boundary\n";
}
