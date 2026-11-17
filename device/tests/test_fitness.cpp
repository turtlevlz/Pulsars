#include "../firmware/bracelet/src/fitness_capture.h"
#include <cassert>
#include <vector>

int main() {
    using device::FitnessCapture;
    FitnessCapture capture;
    size_t measured = 0;
    auto measure = [&]() {
        device::Reading sample;
        sample.motion = {static_cast<float>(++measured), device::Quality::Ok};
        return sample;
    };
    struct Window { uint64_t start; FitnessCapture::Samples samples; };
    std::vector<Window> sent;
    auto emit = [&](uint64_t start, const FitnessCapture::Samples& samples) { sent.push_back({start, samples}); };

    capture.poll(100, measure, emit);
    capture.poll(200, measure, emit);
    capture.poll(2005, measure, emit);
    capture.poll(9050, measure, emit);
    assert(sent.empty());
    capture.poll(10003, measure, emit);
    assert(sent.size() == 1 && sent[0].start == 0);
    assert(sent[0].samples[0]->motion.value == 1);
    assert(!sent[0].samples[1]);
    assert(sent[0].samples[2]->motion.value == 2);
    assert(sent[0].samples[9]->motion.value == 3);
    assert(!sent[0].samples[0]->pulse.valid());

    capture.reset();
    capture.poll(21400, measure, emit);
    capture.poll(30000, measure, emit);
    assert(sent.size() == 2 && sent[1].start == 20000);
    assert(!sent[1].samples[0] && sent[1].samples[1]->motion.value == 5);
    assert(!sent[1].samples[9]);
}
