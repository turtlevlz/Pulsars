import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    PULSARS_HOST: z.string().min(1).optional(),
    DATABASE_URL: z.string().min(1),

    // MQTT device ingestion. Leave MQTT_URL unset to run the API without the subscriber.
    MQTT_URL: z.string().min(1).optional(),
    // Stable id + persistent session: the broker queues QoS 1 messages while the backend is
    // down. Two backend instances need different ids or they will kick each other off.
    MQTT_CLIENT_ID: z.string().min(1).default('pulsars-backend'),

    // Local LLM behind an OpenAI-compatible API (Ollama, llama.cpp server, LM Studio, ...).
    LLM_URL: z.string().min(1).default('http://localhost:11434/v1'),
    LLM_MODEL: z.string().min(1).default('llama3.2'),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

    // A follow-up thread is closed after the assistant has asked this many questions.
    ASSISTANT_MAX_QUESTIONS: z.coerce.number().int().min(1).max(20).default(4),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error('Invalid environment configuration:');
    console.error(z.prettifyError(parsed.error));
    process.exit(1);
}

export const config = parsed.data;
