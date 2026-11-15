import mqtt, { type MqttClient } from 'mqtt';
import { config } from '../config.js';
import { ingest } from '../modules/vitals/service.js';
import { readingSchema } from '../modules/vitals/schemas.js';
import { VITAL_TYPES, type VitalType } from '../modules/vitals/types.js';
import { windowSchema } from '../modules/fitness/schemas.js';
import { ingestWindow } from '../modules/fitness/service.js';

// Topic layout:   pulsars/{userId}/vitals/{hr|bt|bo}
// Payload (JSON): { "value": number, "recordedAt": "<ISO 8601, optional>" }
export const TOPIC_FILTER = 'pulsars/+/vitals/+';
export const FITNESS_TOPIC_FILTER = 'pulsars/+/fitness/window';

const MAX_USER_ID = 2_147_483_647; // Postgres int4
const parseUserId = (value: string): number | null => {
    const id = Number(value);
    return /^[1-9]\d{0,9}$/.test(value) && id <= MAX_USER_ID ? id : null;
};

export function parseTopic(topic: string): { userId: number; type: VitalType } | null {
    const parts = topic.split('/');
    if (parts.length !== 4 || parts[0] !== 'pulsars' || parts[2] !== 'vitals') return null;
    const [, id, , type] = parts;
    const userId = parseUserId(id);
    if (userId === null) return null;
    if (!(VITAL_TYPES as readonly string[]).includes(type)) return null;
    return { userId, type: type as VitalType };
}

function fitnessPatient(topic: string) {
    const parts = topic.split('/');
    const [prefix, patient, section, event] = parts;
    return parts.length === 4 && prefix === 'pulsars' && section === 'fitness' && event === 'window'
        ? parseUserId(patient) : null;
}

export type MessageOutcome = 'stored' | 'duplicate' | 'dropped';

/**
 * Handles one MQTT message. Never throws: a bad message (wrong topic, malformed JSON,
 * out-of-range value, unknown user, ...) is logged and dropped so it can't take the
 * subscriber down. Exported separately from the client so it can be tested directly.
 */
export async function handleMessage(topic: string, payload: Buffer | string): Promise<MessageOutcome> {
    const drop = (reason: string): MessageOutcome => {
        console.warn(`[mqtt] dropped message on "${topic}": ${reason}`);
        return 'dropped';
    };
    try {
        const target = parseTopic(topic);
        const patient = fitnessPatient(topic);
        if (!target && patient === null) return drop('unrecognised topic');

        let body: unknown;
        try {
            body = JSON.parse(payload.toString());
        } catch {
            return drop('payload is not valid JSON');
        }
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            return drop('payload must be a JSON object');
        }

        if (patient !== null) {
            const fitness = windowSchema.safeParse(body);
            if (!fitness.success) return drop('invalid fitness window');
            return await ingestWindow(patient, fitness.data) ? 'stored' : 'duplicate';
        }
        if (!target) return drop('unrecognised vital type');
        // The type comes from the topic and always wins over anything in the payload.
        const reading = readingSchema.safeParse({ ...body, type: target.type });
        if (!reading.success) {
            return drop(reading.error.issues.map((i) => `${i.path.join('.') || 'payload'}: ${i.message}`).join('; '));
        }

        const result = await ingest(target.userId, reading.data);
        return result.stored ? 'stored' : 'duplicate';
    } catch (err) {
        return drop(err instanceof Error ? err.message : String(err));
    }
}

// Node's connection errors (ECONNREFUSED, ...) often arrive as an AggregateError with an empty message.
function describeError(err: Error): string {
    const nested = (err as { errors?: { code?: string }[] }).errors?.[0];
    return err.message || (err as { code?: string }).code || nested?.code || err.name;
}

export interface Subscriber {
    client: MqttClient;
    stop(): Promise<void>;
}

export function startSubscriber(url = config.MQTT_URL): Subscriber {
    if (!url) throw new Error('MQTT_URL is not configured');

    const client = mqtt.connect(url, {
        clientId: config.MQTT_CLIENT_ID,
        clean: false, // keep the session so QoS 1 messages queue while we are down
        reconnectPeriod: 2000,
    });

    client.on('connect', () => {
        console.log(`[mqtt] connected to ${url}`);
        const topics = [TOPIC_FILTER, FITNESS_TOPIC_FILTER];
        client.subscribe(topics, { qos: 1 }, (err) => {
            if (err) console.error('[mqtt] subscribe failed:', err.message);
            else console.log(`[mqtt] subscribed to ${topics.join(', ')}`);
        });
    });
    client.on('reconnect', () => console.warn('[mqtt] reconnecting...'));
    client.on('error', (err) => console.error('[mqtt] error:', describeError(err)));
    client.on('message', (topic, payload) => {
        void handleMessage(topic, payload);
    });

    return { client, stop: () => client.endAsync() };
}
