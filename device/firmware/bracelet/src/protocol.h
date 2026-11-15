#pragma once
#include "device_core.h"
#include "fitness_capture.h"
#include "hardware.h"
#include <cstddef>

struct Identity { char deviceId[32]{}; char bootId[24]{}; };
size_t encodeFrame(char* out, size_t capacity, const Identity& identity, const device::Session& session, size_t index);
size_t encodeFitnessWindow(char* out, size_t capacity, const Identity& identity, uint64_t start,
                           const device::FitnessCapture::Samples& samples);
size_t encodeHello(char* out, size_t capacity, const Identity& identity, const device::Session& session,
                   device::Site configuredSite, const SensorHub& sensors, uint64_t now, uint32_t rawDropped);
size_t encodeReply(char* out, size_t capacity, const Identity& identity, const char* commandId,
                   bool ok, const char* error);
size_t encodeRaw(char* out, size_t capacity, const Identity& identity, const RawSample& sample,
                 uint32_t sessionId, uint32_t fifoOverflows);
