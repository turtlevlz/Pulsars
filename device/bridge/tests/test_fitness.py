from pathlib import Path
import json
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from pulsars_mqtt import PulsarsPublisher
from receiver import Collector, validate


def frame(**overrides):
    return {
        "v": 1, "source": "device", "type": "fitness_window", "device_id": "cuff",
        "boot_id": "boot", "device_time_ms": 10000,
        "samples": [
            {"motion_rms_g": 0.15, "gyro_rms_dps": 9, "pulse_bpm": None, "skin_temp_c": 33.5},
            *([None] * 9),
        ],
        **overrides,
    }


class FitnessBridgeTests(unittest.TestCase):
    def test_window_is_saved_outside_any_vitals_session(self):
        with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as capture:
            collector = Collector(capture, "usb")
            self.assertFalse(collector.receive(frame()))
            self.assertEqual(collector.sessions, {})
            capture.seek(0)
            self.assertEqual(json.loads(capture.readline())["message"], frame())

    def test_publisher_keeps_acquisition_time_and_nullable_measurements(self):
        sent = []
        pub = PulsarsPublisher(2, lambda topic, data: sent.append((topic, json.loads(data))))
        pub.offer({
            "message": frame(type="hello", device_time_ms=4000),
            "received_at_utc": "2026-11-15T18:00:04+00:00",
        })
        pub.offer({"message": frame(), "received_at_utc": "2026-11-15T18:00:20+00:00", "transport": "usb"})
        self.assertEqual(sent, [("pulsars/2/fitness/window", {
            "v": 1, "deviceId": "cuff", "bootId": "boot", "deviceTimeMs": 10000,
            "recordedAt": "2026-11-15T18:00:10.000+00:00", "samples": frame()["samples"],
        })])
        pub.offer({"message": frame(source="synthetic"), "received_at_utc": "2026-11-15T18:00:20+00:00", "transport": "usb"})
        self.assertEqual(len(sent), 1)

    def test_validation_rejects_invalid_slot_data(self):
        valid = frame()["samples"][0]
        invalid_slots = [
            {**valid, "motion_rms_g": -1}, {**valid, "gyro_rms_dps": None},
            {**valid, "pulse_bpm": float("nan")}, {**valid, "skin_temp_c": 85},
            {**valid, "heart_rate": 10},
        ]
        for slots in [[], *([bad, *([None] * 9)] for bad in invalid_slots)]:
            with self.subTest(slots=slots), self.assertRaises(ValueError):
                validate(frame(samples=slots))

    def test_delayed_hello_and_serial_jitter_do_not_push_slots_into_the_future(self):
        names = []
        pub = PulsarsPublisher(2, lambda _, data: names.append(json.loads(data)["recordedAt"]))
        pub.offer({
            "message": frame(type="hello", device_time_ms=1000),
            "received_at_utc": "2026-11-15T18:01:19.633+00:00",
        })
        for uptime, receipt in [(60000, "18:01:20.210"), (70000, "18:01:30.171")]:
            pub.offer({"message": frame(device_time_ms=uptime),
                       "received_at_utc": f"2026-11-15T{receipt}+00:00", "transport": "usb"})
        self.assertEqual(names, ["2026-11-15T18:01:10.000+00:00", "2026-11-15T18:01:20.000+00:00"])


if __name__ == "__main__":
    unittest.main()
