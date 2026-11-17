import bcrypt from 'bcrypt';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import type { ChatMessage, LlmClient } from '../src/llm/client.js';
import { signToken } from '../src/modules/auth/tokens.js';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * A supertest client. Pass a user from makePatient()/makeMedic() to send their bearer token with
 * every request; call it with no argument to test as somebody who is not signed in.
 */
export function api(as?: { token: string }) {
    const call = (method: Method) => (url: string) => {
        const req = request(app)[method](url);
        return as ? req.set('Authorization', `Bearer ${as.token}`) : req;
    };
    return { get: call('get'), post: call('post'), put: call('put'), patch: call('patch'), delete: call('delete') };
}

/** A real (but cheap) bcrypt hash, for tests that sign in with a password. */
export const hashPassword = (password: string) => bcrypt.hash(password, 4);

type UserData = Partial<Parameters<typeof prisma.user.create>[0]['data']>;

let counter = 0;
const nextEmail = (prefix: string) => `${prefix}${++counter}@test.local`;

// Rows are inserted directly. The hash is not a real one unless a test passes `passwordHash`,
// and the returned user carries a valid token for api(user).
async function makeUser(data: Parameters<typeof prisma.user.create>[0]['data']) {
    const user = await prisma.user.create({ data });
    return { ...user, token: await signToken({ userId: user.id, tokenVersion: user.tokenVersion }) };
}

export const makePatient = (over: UserData = {}) =>
    makeUser({
        name: 'Pat Patient',
        email: nextEmail('patient'),
        passwordHash: 'x',
        role: 'patient',
        age: 30,
        weight: 70,
        height: 170,
        ...over,
    });

export const makeMedic = (over: UserData = {}) =>
    makeUser({ name: 'Dr. Medic', email: nextEmail('medic'), passwordHash: 'x', role: 'medic', ...over });

/** Gives a medic access to a patient the way the app does: by assigning them a check-up. */
export const assignCheckup = (medicId: number, userId: number, over: Record<string, unknown> = {}) =>
    prisma.checkup.create({
        data: {
            userId,
            medicId,
            name: 'Weekly check',
            questions: { create: [{ question: 'How do you feel?' }] },
            ...over,
        },
        include: { questions: true },
    });

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
