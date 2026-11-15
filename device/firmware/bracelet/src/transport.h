#pragma once
#include "../config.h"
#include <cstdint>
#include <cstddef>

enum class Link : uint8_t { Usb = 0, Ble = 1, Wifi = 2 };
struct Command {
    Link link = Link::Usb;
    uint32_t generation = 0;
    bool oversized = false;
    char json[config::COMMAND_BYTES]{};
};

namespace transport {
void begin(const char* deviceName);
void poll(uint64_t now, uint32_t sessionId, size_t frameCount,
          size_t (*encode)(char*, size_t, size_t));
bool nextCommand(Command& command);
bool connected(Link link);
const char* wifiAddress();
bool takeConnectedEvent(Link link);
bool queueControl(Link link, const char* json);
bool queueRaw(const char* json);
bool queueFitness(const char* json);
void replay(Link link);
uint32_t rawDropped();
uint32_t commandsDropped();
}
