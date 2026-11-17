from pathlib import Path
from datetime import timedelta
import copy
import asyncio
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

ROOT = Path(__file__).resolve().parents[1]
(ROOT / ".tmp").mkdir(exist_ok=True)
sys.path.insert(0, str(ROOT / "tools"))
import receiver


def example(name="synthetic-finger-complete.ndjson"):
    return [json.loads(line) for line in (ROOT / "interface/examples" / name).read_text().splitlines()]


class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.log = tempfile.TemporaryFile(mode="w+", encoding="utf-8", dir=ROOT / ".tmp")
        self.collector = receiver.Collector(self.log, "fixture")

    def tearDown(self):
        self.log.close()

    def test_fragmentation_at_every_byte_and_multiple_messages(self):
        packets = example()
        payload = b"".join((json.dumps(p) + "\n").encode() for p in packets)
        for chunk_size in (1, 20, 182, len(payload)):
            parser = receiver.Framer()
            result = []
            for i in range(0, len(payload), chunk_size):
                result.extend(parser.feed(payload[i:i + chunk_size]))
            self.assertEqual(result, packets)
            self.assertEqual(parser.rejected, 0)

    def test_complete_is_fsynced_before_ack(self):
        with patch.object(receiver.os, "fsync") as fsync:
            for packet in example():
                commands = self.collector.receive(packet)
                if packet["type"] != "session_end": self.assertFalse(commands)
            self.assertEqual(commands[0]["cmd"], "ack")
            self.assertEqual(commands[0]["last_seq"], 76)
            fsync.assert_called_once_with(self.log.fileno())
        self.assertEqual(self.collector.completed, 1)

    def test_live_capture_is_readable_before_session_end(self):
        with tempfile.TemporaryDirectory(dir=ROOT / ".tmp") as folder:
            output = Path(folder) / "live.ndjson"
            start = example()[0]

            async def check_live_file(args, collector):
                self.assertFalse(collector.receive(start))
                record = json.loads(output.read_text(encoding="utf-8"))
                self.assertEqual(record["message"], start)
                self.assertEqual(record["transport"], "ble")

            argv = ["receiver.py", "--ble", "--output", str(output)]
            with patch.object(sys, "argv", argv), patch.object(receiver, "run_ble", check_live_file):
                receiver.main()

    def test_consecutive_spo2_sessions_keep_quality_and_ack(self):
        for session_id in (1, 2):
            packets = example()
            for packet in packets:
                packet["session_id"] = session_id
                if packet["type"] == "reading" and packet["state"] == "recording":
                    if packet["seq"] % 2 == 0:
                        packet["values"]["spo2_pct"] = 98
                        packet["quality"]["spo2"] = "ok"
                    else:
                        packet["quality"]["spo2"] = "motion"
                commands = self.collector.receive(packet)
            self.assertEqual(commands[0]["cmd"], "ack")
            self.assertEqual(commands[0]["session_id"], session_id)
        self.assertEqual(self.collector.completed, 2)
        self.log.seek(0)
        readings = [json.loads(line)["message"] for line in self.log]
        oxygen = [p["values"]["spo2_pct"] for p in readings if p["type"] == "reading"]
        self.assertIn(98, oxygen)
        self.assertIn(None, oxygen)

    def test_usb_auto_selects_only_a_single_esp32_c3(self):
        unrelated = SimpleNamespace(vid=0x1234, pid=0x1001, device="COM1")
        cuff = SimpleNamespace(vid=0x303A, pid=0x1001, device="COM3")
        second = SimpleNamespace(vid=0x303A, pid=0x1001, device="COM7")
        self.assertEqual(receiver.xiao_ports([unrelated]), [])
        self.assertEqual(receiver.xiao_ports([unrelated, cuff]), ["COM3"])
        self.assertEqual(receiver.xiao_ports([second, cuff]), ["COM3", "COM7"])

    def test_actual_usb_records_map_to_pulsars_and_replay_is_deduplicated(self):
        from pulsars_mqtt import PulsarsPublisher
        packets = example()
        stamp = "2026-11-14T12:00:00.000+00:00"
        publish = Mock()
        bridge = PulsarsPublisher(2, publish)
        collector = receiver.Collector(self.log, "usb", on_record=bridge.offer)
        envelope = {key: packets[0][key] for key in ("v", "device_id", "boot_id")}
        selected = copy.deepcopy(packets[20])
        selected["source"] = "device"
        selected["values"]["spo2_pct"] = 98
        selected["quality"]["spo2"] = "ok"
        with patch.object(receiver, "datetime", wraps=receiver.datetime) as clock:
            clock.now.return_value = receiver.datetime.fromisoformat(stamp)
            collector.receive({**envelope, "source": "device", "type": "hello", "device_time_ms": 0})
            clock.now.return_value += timedelta(milliseconds=selected["device_time_ms"])
            collector.receive(selected)
            collector.receive(selected)
            collector.receive({**packets[21], "source": "synthetic"})
        calls = [(call.args[0], json.loads(call.args[1])) for call in publish.call_args_list]
        self.assertEqual([topic for topic, _ in calls], ["pulsars/2/vitals/hr", "pulsars/2/vitals/bo"])
        self.assertEqual([body["value"] for _, body in calls], [selected["values"]["pulse_bpm"], 98])
        self.assertTrue(all(set(body) == {"value", "recordedAt"} for _, body in calls))
        self.assertEqual(collector.duplicates, 1)

    def test_pulsars_only_forwards_in_range_metrics_with_usable_quality(self):
        from pulsars_mqtt import PulsarsPublisher
        publish = Mock()
        bridge = PulsarsPublisher(7, publish, include_skin_temp=True)
        hello = {"type": "hello", "source": "device", "device_id": "cuff", "boot_id": "boot", "device_time_ms": 100}
        bridge.offer({"message": hello, "received_at_utc": "2026-11-14T12:00:00+00:00"})
        packet = {**hello, "type": "reading", "state": "recording", "device_time_ms": 1100,
                  "values": {"pulse_bpm": None, "spo2_pct": 45, "skin_temp_c": 32.5},
                  "quality": {"pulse": "motion", "spo2": "ok", "skin_temp": "ok"}}
        bridge.offer({"message": packet, "received_at_utc": "2026-11-14T12:00:06+00:00"})
        publish.assert_called_once()
        topic, payload = publish.call_args.args
        self.assertEqual(topic, "pulsars/7/vitals/bt")
        self.assertEqual(json.loads(payload), {"value": 32.5, "recordedAt": "2026-11-14T12:00:01.000+00:00"})

    def _smoothing_bridge(self, include_skin_temp=True):
        from pulsars_mqtt import PulsarsPublisher
        publish = Mock()
        bridge = PulsarsPublisher(7, publish, include_skin_temp=include_skin_temp)
        hello = {"type": "hello", "source": "device", "device_id": "cuff", "boot_id": "boot", "device_time_ms": 0}
        bridge.offer({"message": hello, "received_at_utc": "2026-11-14T12:00:00+00:00"})

        def reading(second, pulse, quality="ok", spo2=97, spo2_quality="ok"):
            packet = {**hello, "type": "reading", "state": "recording", "device_time_ms": second * 1000,
                      "values": {"pulse_bpm": pulse, "spo2_pct": spo2, "skin_temp_c": 33.0},
                      "quality": {"pulse": quality, "spo2": spo2_quality, "skin_temp": "ok"}}
            publish.reset_mock()
            bridge.offer({"message": packet, "received_at_utc": "2026-11-14T12:10:00+00:00"})
            return {call.args[0].rsplit("/", 1)[1]: json.loads(call.args[1]) for call in publish.call_args_list}

        return bridge, reading

    def test_unusable_readings_are_replaced_by_the_mean_of_recent_normal_ones(self):
        _, reading = self._smoothing_bridge()
        for second, pulse in enumerate([70, 72, 74, 76], start=1):
            self.assertEqual(reading(second, pulse)["hr"]["value"], pulse)
        sent = reading(5, None, quality="motion")  # mean of 70, 72, 74, 76
        self.assertEqual(sent["hr"], {"value": 73, "recordedAt": "2026-11-14T12:00:05.000+00:00"})
        self.assertEqual(sent["bo"]["value"], 97)  # the other metrics are untouched
        self.assertEqual(reading(6, None, quality="no_contact")["hr"]["value"], 73)
        self.assertEqual(reading(7, 80)["hr"]["value"], 80)  # a normal reading is sent as it is

    def test_implausible_values_the_device_calls_ok_are_smoothed_too(self):
        _, reading = self._smoothing_bridge()
        for second in range(1, 5):
            reading(second, 70, spo2=96)
        sent = reading(5, 70, spo2=45)  # outside 50-100
        self.assertEqual(sent["bo"]["value"], 96)
        self.assertEqual(sent["hr"]["value"], 70)

    def test_smoothed_readings_do_not_feed_the_mean(self):
        _, reading = self._smoothing_bridge()
        for second, pulse in enumerate([60, 60, 60, 90], start=1):
            reading(second, pulse)
        first = reading(5, None, quality="motion")["hr"]["value"]
        second = reading(6, None, quality="motion")["hr"]["value"]
        self.assertEqual(first, second)  # still the mean of the four normal readings

    def test_a_long_outage_is_left_as_a_gap(self):
        _, reading = self._smoothing_bridge()
        for second in range(1, 5):
            reading(second, 70)
        for second in range(5, 10):  # five substituted readings
            self.assertEqual(reading(second, None, quality="no_contact")["hr"]["value"], 70)
        self.assertNotIn("hr", reading(10, None, quality="no_contact"))
        self.assertNotIn("hr", reading(11, None, quality="no_contact"))
        self.assertEqual(reading(12, 71)["hr"]["value"], 71)  # recovers, and the count starts over
        self.assertEqual(reading(13, None, quality="motion")["hr"]["value"], 70.2)

    def test_nothing_is_invented_without_enough_normal_readings(self):
        _, reading = self._smoothing_bridge()
        reading(1, 70)
        reading(2, 71)  # two normal readings are not enough
        self.assertNotIn("hr", reading(3, None, quality="motion"))

    def test_a_new_boot_starts_with_no_history(self):
        bridge, reading = self._smoothing_bridge()
        for second in range(1, 5):
            reading(second, 70)
        hello = {"type": "hello", "source": "device", "device_id": "cuff", "boot_id": "boot-two", "device_time_ms": 0}
        bridge.offer({"message": hello, "received_at_utc": "2026-11-14T12:20:00+00:00"})
        self.assertEqual(len(bridge.normal["hr"]), 0)
        packet = {**hello, "type": "reading", "state": "recording", "device_time_ms": 1000,
                  "values": {"pulse_bpm": None, "spo2_pct": 97, "skin_temp_c": 33.0},
                  "quality": {"pulse": "motion", "spo2": "ok", "skin_temp": "ok"}}
        bridge.send.reset_mock()
        bridge.offer({"message": packet, "received_at_utc": "2026-11-14T12:20:01+00:00"})
        topics = [call.args[0].rsplit("/", 1)[1] for call in bridge.send.call_args_list]
        self.assertNotIn("hr", topics)  # nothing from the previous boot is carried over

    def test_duplicate_records_are_logged_once(self):
        packets = example()
        for packet in packets:
            self.collector.receive(packet)
            self.collector.receive(packet)
        self.assertEqual(self.collector.duplicates, len(packets))
        self.log.seek(0)
        self.assertEqual(len(self.log.readlines()), len(packets))

    def test_missing_frame_requests_replay_then_recovers(self):
        packets = example()
        for packet in packets:
            if packet["seq"] != 20: commands = self.collector.receive(packet)
        self.assertEqual(commands[0]["cmd"], "replay")
        self.assertEqual(self.collector.completed, 0)
        commands = self.collector.receive(packets[20])
        self.assertEqual(commands[0]["cmd"], "ack")
        self.assertEqual(self.collector.completed, 1)

    def test_fsync_failure_never_acknowledges(self):
        packets = example()
        for packet in packets[:-1]: self.collector.receive(packet)
        with patch.object(receiver.os, "fsync", side_effect=OSError("disk full")):
            with self.assertRaises(OSError): self.collector.receive(packets[-1])
        self.assertEqual(self.collector.completed, 0)
        self.assertFalse(self.collector.ack_ids)

    def test_boot_change_does_not_collide(self):
        for boot in ("boot-one", "boot-two"):
            for packet in example("synthetic-cancelled.ndjson"):
                packet["boot_id"] = boot
                self.collector.receive(packet)
        self.assertEqual(self.collector.completed, 2)
        self.assertEqual(self.collector.duplicates, 0)

    def test_terminal_unsuccessful_sessions_can_be_saved(self):
        for name in ("synthetic-insufficient-signal.ndjson", "synthetic-cancelled.ndjson"):
            collector = receiver.Collector(self.log, "fixture")
            for packet in example(name): commands = collector.receive(packet)
            self.assertEqual(commands[0]["cmd"], "ack")

    def test_quality_requires_null_and_no_wrist_oxygen(self):
        reading = example()[20]
        reading["quality"]["pulse"] = "motion"
        with self.assertRaises(ValueError): receiver.validate(reading)
        reading = example("synthetic-wrist-complete.ndjson")[20]
        reading["values"]["spo2_pct"] = 98
        reading["quality"]["spo2"] = "ok"
        with self.assertRaises(ValueError): receiver.validate(reading)

    def test_overlong_and_invalid_packets_resynchronize(self):
        parser = receiver.Framer()
        packet = example()[0]
        result = parser.feed(b"x" * 5000 + b"\nboot ROM text\n" + (json.dumps(packet) + "\n").encode())
        self.assertEqual(result, [packet])
        self.assertEqual(parser.rejected, 2)

    def test_nan_and_boolean_protocol_are_rejected(self):
        parser = receiver.Framer()
        packet = example()[20]
        packet["values"]["pulse_bpm"] = float("nan")
        self.assertEqual(parser.feed((json.dumps(packet) + "\n").encode()), [])
        packet = example()[0]
        packet["v"] = True
        with self.assertRaises(ValueError): receiver.validate(packet)

    def test_changed_duplicate_and_inconsistent_counters(self):
        packet = example()[0]
        self.collector.receive(packet)
        altered = copy.deepcopy(packet)
        altered["optical_site"] = "wrist"
        with self.assertRaises(ValueError): self.collector.receive(altered)
        collector = receiver.Collector(self.log, "fixture")
        packets = example()
        packets[-1]["valid_pulse_readings"] = 10
        for p in packets[:-1]: collector.receive(p)
        with self.assertRaises(ValueError): collector.receive(packets[-1])

    def test_output_path_is_confined(self):
        self.assertEqual(receiver.inside_root(ROOT / "captures"), ROOT / "captures")
        with self.assertRaises(ValueError): receiver.inside_root(ROOT.parent / "outside.ndjson")

    def test_ble_waits_through_scan_error_and_temporary_absence(self):
        class FakeBleakError(Exception): pass
        class ReachedClient(Exception): pass
        device = SimpleNamespace(address="test-address", name="bracelet-test")
        advert = SimpleNamespace(service_uuids=[receiver.SERVICE])
        scanner = SimpleNamespace(discover=AsyncMock(side_effect=[
            FakeBleakError("temporary radio error"), {}, {device.address: (device, advert)}]))
        client = Mock(side_effect=ReachedClient)
        modules = {"bleak": SimpleNamespace(BleakClient=client, BleakScanner=scanner),
                   "bleak.exc": SimpleNamespace(BleakError=FakeBleakError)}
        args = SimpleNamespace(address=None, mode=None, raw=False, once=False)
        with patch.dict(sys.modules, modules), patch.object(receiver.asyncio, "sleep", new_callable=AsyncMock) as sleep:
            with self.assertRaises(ReachedClient):
                asyncio.run(receiver.run_ble(args, self.collector))
            self.assertEqual(scanner.discover.await_count, 3)
            self.assertEqual(sleep.await_count, 2)
            client.assert_called_once_with(device)

    def test_wifi_reconnect_replays_and_acks_after_save(self):
        async def exercise():
            packets = example()
            served = 0
            failures = []

            async def device(read, write):
                nonlocal served
                served += 1
                try:
                    self.assertEqual(json.loads(await read.readline())["cmd"], "get_status")
                    frames = packets[:20] if served == 1 else packets
                    data = b"".join((json.dumps(packet) + "\n").encode() for packet in frames)
                    write.write(data[:17])
                    await write.drain()
                    write.write(data[17:])
                    await write.drain()
                    if served == 2:
                        ack = json.loads(await read.readline())
                        self.assertEqual(ack["cmd"], "ack")
                        self.assertEqual(ack["last_seq"], 76)
                        self.assertEqual(self.collector.completed, 1)
                        reply = {k: packets[0][k] for k in ("v", "source", "device_id", "boot_id")}
                        reply.update(type="reply", command_id=ack["command_id"], ok=True)
                        write.write((json.dumps(reply) + "\n").encode())
                        await write.drain()
                except Exception as exc:
                    failures.append(exc)
                finally:
                    write.close()
                    await write.wait_closed()

            server = await asyncio.start_server(device, "127.0.0.1", 0)
            async with server:
                args = SimpleNamespace(wifi="127.0.0.1", wifi_port=server.sockets[0].getsockname()[1],
                                       mode=None, raw=False, once=True)
                await asyncio.wait_for(receiver.run_wifi(args, self.collector), 8)
            self.assertFalse(failures)
            self.assertEqual(served, 2)
            self.assertEqual(self.collector.duplicates, 20)
            self.assertEqual(self.collector.ack_confirmed, 1)

        asyncio.run(exercise())

    def test_ble_does_not_choose_between_two_bracelets(self):
        devices = [SimpleNamespace(address=f"address-{i}", name=f"bracelet-{i}") for i in (1, 2)]
        advert = SimpleNamespace(service_uuids=[receiver.SERVICE])
        scanner = SimpleNamespace(discover=AsyncMock(return_value={d.address: (d, advert) for d in devices}))
        client = Mock()
        modules = {"bleak": SimpleNamespace(BleakClient=client, BleakScanner=scanner),
                   "bleak.exc": SimpleNamespace(BleakError=RuntimeError)}
        args = SimpleNamespace(address=None, mode=None, raw=False, once=False)
        with patch.dict(sys.modules, modules):
            with self.assertRaisesRegex(RuntimeError, "Expected one bracelet, found 2"):
                asyncio.run(receiver.run_ble(args, self.collector))
        client.assert_not_called()


if __name__ == "__main__":
    unittest.main()
