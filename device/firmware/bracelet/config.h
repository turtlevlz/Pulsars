#pragma once
#include <cstddef>
#include <cstdint>

#if defined(PLAN_A_USB_DEMO) && (!defined(PLAN_A_COMPETITION) || defined(PLAN_A_WIFI))
#error "PLAN_A_USB_DEMO requires PLAN_A_COMPETITION and excludes PLAN_A_WIFI."
#endif

namespace config {
#ifdef PLAN_A_USB_DEMO
constexpr bool USB_DEMO = true;
#else
constexpr bool USB_DEMO = false;
#endif
#ifdef PLAN_A_COMPETITION
#if defined(PLAN_A_USB_DEMO)
constexpr char FIRMWARE_VERSION[] = "0.2.3";
#elif defined(PLAN_A_WIFI)
constexpr char FIRMWARE_VERSION[] = "0.2.1";
#else
constexpr char FIRMWARE_VERSION[] = "0.2.0";
#endif
constexpr bool AUTOMATIC_CAPTURE = true;
#else
constexpr char FIRMWARE_VERSION[] = "0.1.0";
constexpr bool AUTOMATIC_CAPTURE = false;
#endif
// Set false only for the MAX30102 finger-only procurement alternative.
#ifdef PLAN_A_MAX30102
constexpr bool HAS_GREEN_LED = false;
#else
constexpr bool HAS_GREEN_LED = true;
#endif
constexpr bool ENABLE_EXPERIMENTAL_SPO2 = AUTOMATIC_CAPTURE;
constexpr bool ALLOW_WRIST_TRIAL = HAS_GREEN_LED && !AUTOMATIC_CAPTURE;
constexpr uint8_t SDA_PIN = 6;
constexpr uint8_t SCL_PIN = 7;
constexpr uint8_t BUTTON_PIN = 3;
constexpr uint8_t TEMPERATURE_PIN = 4;
constexpr uint8_t LED_PIN = 5;
constexpr uint32_t I2C_HZ = 100000;
constexpr uint8_t LED_CURRENT_CODE = 60;
constexpr uint32_t CONTACT_MIN_COUNTS = 10000;
constexpr uint32_t SATURATION_COUNTS = 260000;
constexpr float MIN_AC_DC_RATIO = 0.0004f;
constexpr float MOTION_RMS_G = 0.06f;
constexpr float MOTION_GYRO_DPS = 15.0f;
constexpr float TEMPERATURE_SETTLED_RANGE_C = 0.2f;
constexpr size_t PACKET_BYTES = 1536;
constexpr size_t COMMAND_BYTES = 256;
constexpr char SERVICE_UUID[] = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
constexpr char RX_UUID[] = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
constexpr char TX_UUID[] = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
}  // namespace config
