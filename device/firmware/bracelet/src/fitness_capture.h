#pragma once

#include "device_core.h"
#include <array>
#include <optional>

namespace device {

// One observation per scheduled second, with empty slots where sampling was interrupted.
class FitnessCapture {
public:
    static constexpr size_t SECONDS = 10;
    using Samples = std::array<std::optional<Reading>, SECONDS>;

    void reset() { windowStart_.reset(); samples_ = {}; }

    template<class Measure, class Emit>
    void poll(uint64_t now, Measure measure, Emit emit) {
        const uint64_t second = now / 1000;
        const size_t slot = second % SECONDS;
        const uint64_t start = (second - slot) * 1000;
        if (windowStart_ && *windowStart_ != start) {
            emit(*windowStart_, samples_);
            reset();
        }
        windowStart_ = start;
        if (!samples_[slot]) samples_[slot] = measure();
    }

private:
    std::optional<uint64_t> windowStart_;
    Samples samples_{};
};

}  // namespace device
