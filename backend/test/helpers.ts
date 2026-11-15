import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import type { ChatMessage, LlmClient } from '../src/llm/client.js';

export const api = () => request(app);

// Rows are inserted directly; the hash is never verified in tests, so it needn't be real.
export const makePatient = (over: Partial<Parameters<typeof prisma.user.create>[0]['data']> = {}) =>
    prisma.user.create({
        data: { name: 'Pat Patient', passwordHash: 'x', role: 'patient', age: 30, weight: 70, height: 170, ...over },
    });

export const makeMedic = (over: Partial<Parameters<typeof prisma.user.create>[0]['data']> = {}) =>
    prisma.user.create({ data: { name: 'Dr. Medic', passwordHash: 'x', role: 'medic', ...over } });

export const makeSymptom = (userId: number, over: Record<string, unknown> = {}) =>
    prisma.symptom.create({
        data: { userId, name: 'Headache', intensity: 3, frequency: 'daily', ...over },
    });

/** A model that answers from a queue and records every prompt it was given. An Error in the queue is thrown. */
export function scriptedLlm(replies: (string | Error)[]) {
    const calls: ChatMessage[][] = [];
    const client: LlmClient = {
        async chat(messages) {
            calls.push(messages);
            const next = replies.shift();
            if (next === undefined) throw new Error('scriptedLlm: no scripted reply left');
            if (next instanceof Error) throw next;
            return next;
        },
    };
    return { client, calls };
}

export const reply = (question: string | null, done = false) => JSON.stringify({ question, done });
