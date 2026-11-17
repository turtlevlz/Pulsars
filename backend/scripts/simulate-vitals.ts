// Publishes a fake skin-temperature reading to the MQTT broker, like the wearable would, every
// interval. Only skin temperature (`bt`) is simulated, and it stays put: a fixed resting value with
// a tiny jitter, so it never drifts into a tier change. Heart rate, blood oxygen and motion are not
// published at all (use the real band for those).
//   npm run simulate -- [userId=2] [intervalMs=1000] [count=0 (forever)]
import 'dotenv/config';
import mqtt from 'mqtt';

const [userId = '2', intervalMs = '1000', count = '0'] = process.argv.slice(2);
const url = process.env.MQTT_URL ?? 'mqtt://localhost:1883';

// A typical wrist skin temperature, with +/- 0.05 °C of sensor noise. Not a random walk: the next
// value does not depend on the last one, so the series cannot wander away from the base.
const BASE_CELSIUS = 36.6;
const JITTER_CELSIUS = 0.05;

function nextTemperature(): number {
    const value = BASE_CELSIUS + (Math.random() - 0.5) * 2 * JITTER_CELSIUS;
    return Math.round(value * 100) / 100;
}

const client = mqtt.connect(url, { clientId: `pulsars-sim-${process.pid}` });
let sent = 0;

client.on('error', (err) => console.error('mqtt error:', err.message));
client.on('connect', () => {
    console.log(`Publishing skin temperature for user ${userId} to ${url} every ${intervalMs}ms (Ctrl+C to stop)`);
    const timer = setInterval(async () => {
        const recordedAt = new Date().toISOString();
        const value = nextTemperature();
        await client.publishAsync(`pulsars/${userId}/vitals/bt`, JSON.stringify({ value, recordedAt }), { qos: 1 });
        console.log(`${recordedAt} bt=${value}`);
        if (Number(count) > 0 && ++sent >= Number(count)) {
            clearInterval(timer);
            await client.endAsync();
        }
    }, Number(intervalMs));
});
