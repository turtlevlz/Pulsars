// Publishes fake sensor readings to the MQTT broker, like a wearable would.
//   npm run simulate -- [userId=2] [intervalMs=1000] [count=0 (forever)]
import 'dotenv/config';
import mqtt from 'mqtt';

const [userId = '2', intervalMs = '1000', count = '0'] = process.argv.slice(2);
const url = process.env.MQTT_URL ?? 'mqtt://localhost:1883';

// Random walks around a resting baseline, clamped to plausible ranges.
const state = { hr: 72, bt: 36.7, bo: 97 };
const step = { hr: 3, bt: 0.1, bo: 0.5 };
const clamp = { hr: [45, 140], bt: [30, 39], bo: [90, 100] } as const;

function next(type: keyof typeof state): number {
    const [lo, hi] = clamp[type];
    const v = state[type] + (Math.random() - 0.5) * 2 * step[type];
    state[type] = Math.min(hi, Math.max(lo, v));
    return Math.round(state[type] * 10) / 10;
}

const client = mqtt.connect(url, { clientId: `pulsars-sim-${process.pid}` });
let sent = 0;

client.on('error', (err) => console.error('mqtt error:', err.message));
client.on('connect', () => {
    console.log(`Publishing for user ${userId} to ${url} every ${intervalMs}ms (Ctrl+C to stop)`);
    const timer = setInterval(async () => {
        const recordedAt = new Date().toISOString();
        for (const type of ['hr', 'bt', 'bo'] as const) {
            const value = next(type);
            await client.publishAsync(`pulsars/${userId}/vitals/${type}`, JSON.stringify({ value, recordedAt }), { qos: 1 });
            console.log(`${recordedAt} ${type}=${value}`);
        }
        if (Number(count) > 0 && ++sent >= Number(count)) {
            clearInterval(timer);
            await client.endAsync();
        }
    }, Number(intervalMs));
});
