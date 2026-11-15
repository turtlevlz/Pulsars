"""Map live USB measurements to the Pulsars backend-dev MQTT contract."""
from collections import deque
from contextlib import contextmanager
from datetime import datetime, timedelta
import json
import math
import statistics
import sys


# Bounds match backend/src/modules/vitals/types.ts on Pulsars backend-dev.
VITALS = (
    ("hr", "pulse_bpm", "pulse", 20, 250),
    ("bo", "spo2_pct", "spo2", 50, 100),
    ("bt", "skin_temp_c", "skin_temp", 30, 45),
)

# A reading the device cannot vouch for (finger motion, lost contact, a number outside the plausible
# range) is not dropped. The mean of the last few normal readings is sent in its place, like
# smoothing out turbulence. Only a few seconds are bridged this way: a longer outage stays a gap, so
# the dashboard shows the data going stale instead of a flat line made of averages. Readings the
# device marks "ok" and that are in range are never altered, and the local capture keeps what the
# device really sent.
SMOOTHING_WINDOW = 10    # normal readings remembered per metric
SMOOTHING_MINIMUM = 3    # normal readings needed before anything is substituted
SMOOTHING_MAX_RUN = 5    # substituted readings in a row (about five seconds)


class PulsarsPublisher:
    def __init__(self, user_id, send, *, include_skin_temp=False):
        self.user_id = user_id
        self.send = send
        self.include_skin_temp = include_skin_temp
        self.boot = None
        self.clock_origin = None
        self.fitness_origin = None
        self.forget_readings()

    def forget_readings(self):
        self.normal = {vital: deque(maxlen=SMOOTHING_WINDOW) for vital, *_ in VITALS}
        self.substituted = {vital: 0 for vital, *_ in VITALS}

    def offer(self, record):
        packet = record["message"]
        if packet["source"] != "device":
            return
        boot = (packet["device_id"], packet["boot_id"])
        device_time = packet.get("device_time_ms")
        if type(device_time) is not int or device_time < 0:
            return
        received_at = datetime.fromisoformat(record["received_at_utc"])
        is_fitness = packet["type"] == "fitness_window" and record.get("transport") == "usb"
        try:
            uptime = timedelta(milliseconds=device_time)
            if packet["type"] == "hello" and boot != self.boot:
                self.clock_origin = received_at - uptime
                self.boot = boot
                self.fitness_origin = None
                self.forget_readings()
            if boot != self.boot:
                return
            if is_fitness:
                if self.fitness_origin is None:
                    # USB can deliver an old hello on open. The first completed window
                    # bounds its start to ten seconds before receipt.
                    end_based_origin = received_at - uptime - timedelta(seconds=10)
                    self.fitness_origin = min(self.clock_origin, end_based_origin).replace(microsecond=0)
                at = self.fitness_origin + uptime
            else:
                # A late replay preserves the vitals boot-clock anchor.
                at = min(self.clock_origin + uptime, received_at)
            recorded_at = at.isoformat(timespec="milliseconds")
        except OverflowError:
            return
        if is_fitness:
            message = {"v": 1, "deviceId": boot[0], "bootId": boot[1], "deviceTimeMs": device_time,
                       "recordedAt": recorded_at, "samples": packet["samples"]}
            self.send(f"pulsars/{self.user_id}/fitness/window", json.dumps(message, separators=(",", ":")))
            return
        if packet["type"] != "reading" or packet["state"] != "recording":
            return
        for vital, field, quality, minimum, maximum in VITALS:
            if vital == "bt" and not self.include_skin_temp:
                continue
            value = packet["values"][field]
            normal = self.normal[vital]
            if (packet["quality"][quality] == "ok" and type(value) in (int, float)
                    and math.isfinite(value) and minimum <= value <= maximum):
                normal.append(value)
                self.substituted[vital] = 0
            elif len(normal) >= SMOOTHING_MINIMUM and self.substituted[vital] < SMOOTHING_MAX_RUN:
                if self.substituted[vital] == 0:
                    why = packet["quality"][quality] if packet["quality"][quality] != "ok" else "out of range"
                    print(f"Pulsars {vital}: reading not usable ({why}); "
                          f"sending the mean of the last {len(normal)} normal readings", flush=True)
                value = round(statistics.fmean(normal), 2)
                self.substituted[vital] += 1
            else:
                if len(normal) >= SMOOTHING_MINIMUM and self.substituted[vital] == SMOOTHING_MAX_RUN:
                    print(f"Pulsars {vital}: no normal reading for {SMOOTHING_MAX_RUN} s; "
                          "nothing is sent until one returns", flush=True)
                    self.substituted[vital] += 1  # say it once
                continue
            self.send(f"pulsars/{self.user_id}/vitals/{vital}",
                      json.dumps({"value": value, "recordedAt": recorded_at}, separators=(",", ":")))



@contextmanager
def pulsars_connection(user_id, port, include_skin_temp):
    try:
        from paho.mqtt import client as mqtt
    except ImportError as exc:
        raise RuntimeError("The Pulsars bridge needs paho-mqtt from tools/requirements.txt") from exc

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.max_queued_messages_set(512)
    client.reconnect_delay_set(min_delay=1, max_delay=5)

    def on_connect(_client, _userdata, _flags, reason, _properties):
        if reason.is_failure:
            print(f"Pulsars MQTT connection refused: {reason}", file=sys.stderr, flush=True)
        else:
            print(f"Pulsars MQTT connected on localhost:{port} for patient {user_id}", flush=True)

    def send(topic, payload):
        result = client.publish(topic, payload, qos=1, retain=False)
        if result.rc not in (mqtt.MQTT_ERR_SUCCESS, mqtt.MQTT_ERR_NO_CONN):
            print(f"Pulsars MQTT skipped {topic}: {mqtt.error_string(result.rc)}. "
                  "The original record is in the capture file.", file=sys.stderr, flush=True)

    client.on_connect = on_connect
    client.connect_async("127.0.0.1", port, keepalive=30)
    client.loop_start()
    print(f"Waiting for the Pulsars MQTT broker on localhost:{port}", flush=True)
    try:
        yield PulsarsPublisher(user_id, send, include_skin_temp=include_skin_temp)
    finally:
        client.disconnect()
        client.loop_stop()
