#!/usr/bin/env python3
"""USB, BLE and local Wi-Fi receiver. Saves complete sessions before acknowledging."""
from __future__ import annotations
import argparse
import asyncio
from collections import OrderedDict
from contextlib import ExitStack
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
MAX_LINE = 1536
SESSION_TYPES = {"session_start", "session_state", "reading", "session_end"}
TERMINAL = {"complete", "insufficient_signal", "cancelled", "fault"}
QUALITIES = {"ok", "warming", "no_contact", "motion", "poor_signal", "insufficient_data",
             "sensor_fault", "saturated", "fifo_overflow", "motion_unavailable", "disabled", "unsupported"}
METRICS = {"pulse_bpm": "pulse", "spo2_pct": "spo2", "skin_temp_c": "skin_temp",
           "motion_rms_g": "motion", "gyro_rms_dps": "motion"}
FITNESS_RANGES = {"motion_rms_g": (0, 8), "gyro_rms_dps": (0, 500),
                  "pulse_bpm": (20, 250), "skin_temp_c": (-55, 125)}


def integer(value, minimum=0, maximum=2**64 - 1):
    return type(value) is int and minimum <= value <= maximum


def validate_fitness_window(packet):
    samples = packet.get("samples")
    if (not integer(packet.get("device_time_ms"), maximum=2**53 - 1)
            or not isinstance(samples, list) or len(samples) != 10):
        raise ValueError("Invalid fitness window timestamp or sample count")
    for sample in samples:
        if sample is None:
            continue
        if not isinstance(sample, dict) or sample.keys() != FITNESS_RANGES.keys():
            raise ValueError("Invalid fitness sample fields")
        for field, (minimum, maximum) in FITNESS_RANGES.items():
            value = sample[field]
            if value is not None and (type(value) not in (int, float) or not minimum <= value <= maximum):
                raise ValueError(f"Invalid fitness measurement: {field}")
        if ((sample["motion_rms_g"] is None) != (sample["gyro_rms_dps"] is None)
                or sample["skin_temp_c"] == 85):
            raise ValueError("Invalid fitness sensor reading")


def validate(packet):
    if not isinstance(packet, dict) or type(packet.get("v")) is not int or packet["v"] != 1:
        raise ValueError("Expected a protocol-v1 JSON object")
    if packet.get("source") not in {"device", "synthetic"}:
        raise ValueError("Missing or invalid data provenance")
    for field in ("device_id", "boot_id"):
        if not isinstance(packet.get(field), str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", packet[field]):
            raise ValueError(f"Invalid {field}")
    kind = packet.get("type")
    if kind not in SESSION_TYPES | {"hello", "reply", "raw", "fitness_window"}:
        raise ValueError("Unknown message type")
    if kind == "fitness_window":
        validate_fitness_window(packet)
    if kind in SESSION_TYPES:
        if not integer(packet.get("session_id"), 1, 2**32 - 1) or not integer(packet.get("seq"), 0, 95):
            raise ValueError("Invalid session identifier or sequence")
        if packet.get("optical_site") not in {"finger", "wrist"}:
            raise ValueError("Invalid optical placement")
        if not integer(packet.get("elapsed_ms")) or not integer(packet.get("device_time_ms")):
            raise ValueError("Invalid measurement timing")
        if kind == "session_start" and (packet["seq"] != 0 or packet.get("state") != "stabilizing"):
            raise ValueError("Invalid session start")
        if kind == "session_state" and packet.get("state") != "recording":
            raise ValueError("Invalid state transition")
        if kind == "reading":
            if packet.get("state") not in {"stabilizing", "recording"}:
                raise ValueError("Invalid reading phase")
            values, quality = packet.get("values"), packet.get("quality")
            if not isinstance(values, dict) or not isinstance(quality, dict):
                raise ValueError("Missing values or quality")
            for field, label in METRICS.items():
                if field not in values or quality.get(label) not in QUALITIES:
                    raise ValueError(f"Missing measurement or quality: {field}")
                value = values[field]
                if quality[label] == "ok":
                    if type(value) not in (int, float) or not math.isfinite(value):
                        raise ValueError(f"Non-finite or missing valid value: {field}")
                elif value is not None:
                    raise ValueError(f"Invalid values must be null: {field}")
            if packet["optical_site"] == "wrist" and (values["spo2_pct"] is not None or quality["spo2"] != "unsupported"):
                raise ValueError("Wrist oxygen is unsupported")
            if type(packet.get("contact_estimated")) is not bool:
                raise ValueError("Missing contact estimate")
        if kind == "session_end":
            if packet.get("state") not in TERMINAL or packet.get("frame_count") != packet["seq"] + 1:
                raise ValueError("Invalid terminal frame")
            for field in ("expected_recording_readings", "observed_recording_readings", "valid_pulse_readings"):
                if not integer(packet.get(field), 0, 90):
                    raise ValueError(f"Invalid session counter: {field}")
            if packet["expected_recording_readings"] != 60:
                raise ValueError("Unexpected v1 recording duration")
    return packet


class Framer:
    """Accept arbitrary USB/BLE chunks; discard an oversized line through its newline."""
    def __init__(self):
        self.buffer = bytearray()
        self.discarding = False
        self.rejected = 0

    def feed(self, chunk):
        packets = []
        for byte in chunk:
            if byte == 10:
                if self.discarding:
                    self.discarding = False
                elif self.buffer:
                    try:
                        packet = json.loads(self.buffer.decode("utf-8"),
                                            parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
                        packets.append(validate(packet))
                    except (ValueError, UnicodeError, TypeError):
                        self.rejected += 1
                self.buffer.clear()
            elif not self.discarding:
                if len(self.buffer) >= MAX_LINE - 1:
                    self.buffer.clear()
                    self.discarding = True
                    self.rejected += 1
                else:
                    self.buffer.append(byte)
        return packets


class Collector:
    def __init__(self, output, transport, on_record=None):
        self.output, self.transport = output, transport
        self.on_record = on_record
        self.sessions = OrderedDict()
        self.command_number = 0
        self.completed = 0
        self.ack_confirmed = 0
        self.duplicates = 0
        self.ack_ids = {}

    def command(self, name, **fields):
        self.command_number += 1
        return {"v": 1, "command_id": f"receiver-{self.command_number}", "cmd": name, **fields}

    def _ack(self, key, state):
        command = self.command("ack", boot_id=key[2], session_id=key[3], last_seq=state["end"])
        self.ack_ids[command["command_id"]] = key
        if len(self.ack_ids) > 32:
            del self.ack_ids[next(iter(self.ack_ids))]
        state["last_ack"] = time.monotonic()
        return command

    def _complete(self, frames, last):
        if set(frames) != set(range(last + 1)):
            return False
        start, end = frames[0], frames[last]
        if start["type"] != "session_start" or end["type"] != "session_end":
            raise ValueError("Session lacks start or end")
        readings = [p for p in frames.values() if p["type"] == "reading" and p["state"] == "recording"]
        valid = sum(p["quality"]["pulse"] == "ok" for p in readings)
        if end["observed_recording_readings"] != len(readings) or end["valid_pulse_readings"] != valid:
            raise ValueError("Session counts disagree with its records")
        if end["state"] == "complete" and valid < 48:
            raise ValueError("Complete session has less than 80 percent usable pulse coverage")
        previous_time = -1
        for seq in range(last + 1):
            p = frames[seq]
            if p["optical_site"] != start["optical_site"] or p["device_time_ms"] < previous_time:
                raise ValueError("Placement or time changed inconsistently within a session")
            if p["device_time_ms"] - start["device_time_ms"] != p["elapsed_ms"]:
                raise ValueError("Elapsed time disagrees with the device clock")
            previous_time = p["device_time_ms"]
        return True

    def receive(self, packet):
        validate(packet)
        commands = []
        kind = packet["type"]
        key = None
        if kind in SESSION_TYPES:
            key = (packet["source"], packet["device_id"], packet["boot_id"], packet["session_id"])
            if key not in self.sessions:
                if len(self.sessions) >= 16:
                    old = next((k for k, s in self.sessions.items() if s["durable"]), None)
                    if old is None:
                        raise ValueError("Too many incomplete sessions")
                    del self.sessions[old]
                self.sessions[key] = {"frames": {}, "end": None, "durable": False,
                                      "last_replay": -math.inf, "last_ack": -math.inf}
            state = self.sessions[key]
            frames = state["frames"]
            if packet["seq"] in frames:
                if frames[packet["seq"]] != packet:
                    raise ValueError("Retransmission changed a stored record")
                self.duplicates += 1
            else:
                self._write(packet)
                frames[packet["seq"]] = packet
            if kind == "session_end":
                state["end"] = packet["seq"]
            if state["end"] is not None:
                if self._complete(frames, state["end"]):
                    if not state["durable"]:
                        # A failed flush/fsync raises; no acknowledgment is constructed in that case.
                        self.output.flush()
                        os.fsync(self.output.fileno())
                        state["durable"] = True
                        self.completed += 1
                    if time.monotonic() - state["last_ack"] >= 1:
                        commands.append(self._ack(key, state))
                elif time.monotonic() - state["last_replay"] >= 2:
                    state["last_replay"] = time.monotonic()
                    commands.append(self.command("replay"))
        else:
            self._write(packet)
            if kind == "reply" and packet.get("command_id") in self.ack_ids:
                if packet.get("ok") is True:
                    self.ack_confirmed += 1
                del self.ack_ids[packet["command_id"]]
            if kind == "hello" and packet.get("pending_ack"):
                session_id = packet.get("buffered_session_id")
                key = (packet["source"], packet["device_id"], packet["boot_id"], session_id)
                state = self.sessions.get(key)
                if state and state["durable"]:
                    commands.append(self._ack(key, state))
                elif packet.get("state") in TERMINAL:
                    if not state or time.monotonic() - state["last_replay"] >= 2:
                        if state: state["last_replay"] = time.monotonic()
                        commands.append(self.command("replay"))
        return commands

    def _write(self, packet):
        record = {"received_at_utc": datetime.now(timezone.utc).isoformat(),
                  "transport": self.transport, "message": packet}
        self.output.write(json.dumps(record, allow_nan=False, separators=(",", ":")) + "\n")
        if self.on_record is not None:
            self.on_record(record)


def wire(command):
    payload = (json.dumps(command, separators=(",", ":")) + "\n").encode()
    if len(payload) > 255:
        raise ValueError("Command exceeds device buffer")
    return payload


def inside_root(path):
    path = path.expanduser().resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError("Diagnostic files must remain inside Plan A")
    return path


class Connection:
    def __init__(self, args, collector):
        self.args, self.collector = args, collector
        self.framer = Framer()
        self.configured = False

    def consume(self, chunk):
        commands = []
        for packet in self.framer.feed(chunk):
            commands.extend(self.collector.receive(packet))
            if packet["type"] == "hello":
                print(f"{packet['source']} {packet['device_id']}: {packet.get('state')}; "
                      f"mode={packet.get('configured_site')}; pending_ack={packet.get('pending_ack')}")
            elif packet["type"] in {"session_start", "session_state", "session_end"}:
                print(f"{packet['source']} session {packet['session_id']}: {packet['state']} "
                      f"at {packet['elapsed_ms']} ms")
            elif packet["type"] == "reply" and packet.get("ok") is True:
                print(f"Command accepted: {packet.get('command_id')}")
            if packet["type"] == "hello" and not packet.get("pending_ack") and not self.configured:
                self.configured = True
                if self.args.mode:
                    commands.append(self.collector.command("set_mode", optical_site=self.args.mode))
                if self.args.raw:
                    commands.append(self.collector.command("raw", enabled=True))
            if packet["type"] == "reply" and packet.get("ok") is False:
                print("Device rejected command:", packet.get("error"), file=sys.stderr)
        return commands


def xiao_ports(ports):
    # The XIAO ESP32C3 uses Espressif's native USB Serial/JTAG interface.
    return sorted(port.device for port in ports if (port.vid, port.pid) == (0x303A, 0x1001))


async def run_usb(args, collector):
    try:
        import serial
        from serial.tools import list_ports
    except ImportError as exc:
        raise RuntimeError("USB requires pyserial; install tools/requirements.txt in the local venv") from exc
    last_wait_message = None
    status_fields = {"fitness": True} if getattr(args, "pulsars_user_id", None) is not None else {}
    while True:
        device = args.port
        if device == "auto":
            candidates = xiao_ports(list_ports.comports())
            if len(candidates) != 1:
                message = ("Waiting for the XIAO ESP32C3 USB cable." if not candidates else
                           f"Multiple Espressif ports: {', '.join(candidates)}. Specify --port COMn.")
                if message != last_wait_message:
                    print(message, flush=True)
                    last_wait_message = message
                await asyncio.sleep(1)
                continue
            device = candidates[0]
            last_wait_message = None
        connection = Connection(args, collector)
        try:
            with serial.Serial(device, 115200, timeout=0.1, write_timeout=0.2) as port:
                print(f"Opened USB port {device}", flush=True)
                port.write(wire(collector.command("get_status", **status_fields)))
                status_at = time.monotonic()
                while True:
                    for command in connection.consume(port.read(2048)):
                        port.write(wire(command))
                    if args.once and collector.ack_confirmed:
                        return
                    if time.monotonic() - status_at >= 5:
                        port.write(wire(collector.command("get_status", **status_fields)))
                        status_at = time.monotonic()
                    await asyncio.sleep(0)
        except serial.SerialException as exc:
            print(f"USB disconnected: {exc}; retrying", file=sys.stderr, flush=True)
            await asyncio.sleep(2)


async def run_wifi(args, collector):
    while True:
        writer = None
        try:
            reader, writer = await asyncio.wait_for(asyncio.open_connection(args.wifi, args.wifi_port), 5)
            connection = Connection(args, collector)
            writer.write(wire(collector.command("get_status")))
            await asyncio.wait_for(writer.drain(), 5)
            while True:
                chunk = await asyncio.wait_for(reader.read(4096), 20)
                if not chunk:
                    raise ConnectionError("device closed the connection")
                try:
                    commands = connection.consume(chunk)
                except OSError as exc:
                    raise RuntimeError(f"Could not save Wi-Fi capture: {exc}") from exc
                for command in commands:
                    writer.write(wire(command))
                await asyncio.wait_for(writer.drain(), 5)
                if args.once and collector.ack_confirmed:
                    return
        except (ConnectionError, TimeoutError, OSError) as exc:
            print(f"Wi-Fi disconnected: {exc}; reconnecting", file=sys.stderr)
        finally:
            if writer is not None:
                writer.close()
                try:
                    await asyncio.wait_for(writer.wait_closed(), 2)
                except (OSError, TimeoutError):
                    pass
        await asyncio.sleep(2)


async def run_ble(args, collector):
    try:
        from bleak import BleakClient, BleakScanner
        from bleak.exc import BleakError
    except ImportError as exc:
        raise RuntimeError("BLE requires bleak; install tools/requirements.txt in the local venv") from exc
    while True:
        try:
            found = await BleakScanner.discover(timeout=5, return_adv=True)
        except (BleakError, asyncio.TimeoutError) as exc:
            print(f"BLE scan failed: {exc}; retrying", file=sys.stderr)
            await asyncio.sleep(2)
            continue
        matches = [device for device, adv in found.values()
                   if (args.address and device.address.lower() == args.address.lower()) or
                   (not args.address and SERVICE in [s.lower() for s in adv.service_uuids])]
        if not matches:
            print("Bracelet not currently advertising; waiting to reconnect", file=sys.stderr)
            await asyncio.sleep(2)
            continue
        if len(matches) != 1:
            descriptions = ", ".join(f"{d.name}: {d.address}" for d in matches)
            raise RuntimeError(f"Expected one bracelet, found {len(matches)}. Use --address. {descriptions}")
        chunks = asyncio.Queue(maxsize=256)
        dropped = False
        connection = Connection(args, collector)

        def notification(_, data):
            nonlocal dropped
            try: chunks.put_nowait(bytes(data))
            except asyncio.QueueFull: dropped = True

        try:
            async with BleakClient(matches[0]) as client:
                await client.start_notify(TX, notification)

                async def send(command):
                    # 20 bytes also works with the default ATT MTU of 23.
                    payload = wire(command)
                    for offset in range(0, len(payload), 20):
                        await client.write_gatt_char(RX, payload[offset:offset + 20], response=True)

                await send(collector.command("get_status"))
                status_at = time.monotonic()
                while client.is_connected:
                    if dropped:
                        connection.framer = Framer()
                        dropped = False
                        await send(collector.command("replay"))
                    try:
                        chunk = await asyncio.wait_for(chunks.get(), timeout=1)
                        for command in connection.consume(chunk):
                            await send(command)
                    except asyncio.TimeoutError:
                        pass
                    if args.once and collector.ack_confirmed:
                        return
                    if time.monotonic() - status_at >= 5:
                        await send(collector.command("get_status"))
                        status_at = time.monotonic()
        except (BleakError, asyncio.TimeoutError) as exc:
            print(f"BLE disconnected: {exc}; reconnecting", file=sys.stderr)
        await asyncio.sleep(2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--usb", action="store_true")
    mode.add_argument("--ble", action="store_true")
    mode.add_argument("--wifi", metavar="HOST", help="Connect to the cuff on the local network")
    mode.add_argument("--fixture", type=Path)
    parser.add_argument("--port", help="USB serial port, or auto for a single XIAO ESP32C3")
    parser.add_argument("--wifi-port", type=int, default=8765)
    parser.add_argument("--address")
    parser.add_argument("--mode", choices=("finger", "wrist"))
    parser.add_argument("--raw", action="store_true")
    parser.add_argument("--once", action="store_true", help="Exit after a complete session's ACK is accepted")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--pulsars-user-id", type=int, help="Publish live USB vitals and fitness to this Pulsars patient")
    parser.add_argument("--pulsars-mqtt-port", type=int, default=1883, help="Local MQTT broker port")
    parser.add_argument("--pulsars-skin-temp", action="store_true",
                        help="Use Pulsars bt for forearm skin temperature after the dashboard is relabelled")
    args = parser.parse_args()
    if args.usb and not args.port: parser.error("--usb requires --port")
    if not 1 <= args.wifi_port <= 65535: parser.error("--wifi-port must be between 1 and 65535")
    if args.raw and not args.usb: parser.error("--raw requires --usb")
    if args.pulsars_user_id is not None and (not args.usb or not 1 <= args.pulsars_user_id <= 2147483647):
        parser.error("--pulsars-user-id requires --usb and a positive Pulsars patient ID")
    if not 1 <= args.pulsars_mqtt_port <= 65535:
        parser.error("--pulsars-mqtt-port must be between 1 and 65535")
    if args.pulsars_skin_temp and args.pulsars_user_id is None:
        parser.error("--pulsars-skin-temp requires --pulsars-user-id")
    output = inside_root(args.output or ROOT / "captures" / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".ndjson"))
    output.parent.mkdir(parents=True, exist_ok=True)
    with ExitStack() as resources:
        publish = None
        if args.pulsars_user_id is not None:
            from pulsars_mqtt import pulsars_connection

            publisher = resources.enter_context(pulsars_connection(args.pulsars_user_id, args.pulsars_mqtt_port,
                                                                    args.pulsars_skin_temp))
            publish = publisher.offer
        logfile = resources.enter_context(output.open("x", encoding="utf-8", buffering=1))
        print(f"Writing capture: {output}", flush=True)
        capture_transport = "fixture" if args.fixture else "usb" if args.usb else "wifi" if args.wifi else "ble"
        collector = Collector(logfile, capture_transport, on_record=publish)
        try:
            if args.fixture:
                connection = Connection(args, collector)
                with inside_root(args.fixture).open("rb") as fixture:
                    while chunk := fixture.read(20):
                        for command in connection.consume(chunk):
                            print("SIMULATED COMMAND", json.dumps(command))
                if connection.framer.buffer or connection.framer.discarding or connection.framer.rejected:
                    raise ValueError("Fixture contained incomplete or rejected data")
            else:
                receive = run_usb if args.usb else run_wifi if args.wifi else run_ble
                asyncio.run(receive(args, collector))
        except KeyboardInterrupt:
            pass
        finally:
            logfile.flush()
            os.fsync(logfile.fileno())
            print(f"Capture: {output}\nDurable sessions: {collector.completed}; duplicate records ignored: {collector.duplicates}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        print(f"Receiver error: {error}", file=sys.stderr)
        raise SystemExit(1)
