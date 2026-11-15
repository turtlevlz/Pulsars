"""Map live USB measurements to the Pulsars backend-dev MQTT contract."""
from contextlib import contextmanager
from datetime import datetime, timedelta
import json
import math
import sys


# Bounds match backend/src/modules/vitals/types.ts on Pulsars backend-dev.
VITALS = (
    ("hr", "pulse_bpm", "pulse", 20, 250),
    ("bo", "spo2_pct", "spo2", 50, 100),
    ("bt", "skin_temp_c", "skin_temp", 30, 45),
)


class PulsarsPublisher:
    def __init__(self, user_id, send, *, include_skin_temp=False):
        self.user_id = user_id
        self.send = send
        self.include_skin_temp = include_skin_temp
        self.boot = None
        self.clock_origin = None
        self.fitness_origin = None

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
            if (packet["quality"][quality] == "ok" and type(value) in (int, float)
                    and math.isfinite(value) and minimum <= value <= maximum):
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
