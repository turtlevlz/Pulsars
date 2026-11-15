import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { waitForBackgroundWork } from '../src/modules/assistant/service.js';
import { api, makeMedic, makePatient, makeSymptom } from './helpers.js';

const valid = { name: 'Headache', intensity: 3, frequency: 'daily', notes: 'behind the eyes', durationMinutes: 90 };

describe('POST /users/:id/symptoms', () => {
    it('logs a symptom and opens its first follow-up thread in the background', async () => {
        const u = await makePatient();
        const res = await api(u).post(`/users/${u.id}/symptoms`).send(valid);
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ userId: u.id, name: 'Headache', intensity: 3, frequency: 'daily', durationMinutes: 90 });
        expect(res.body.threadId).toEqual(expect.any(Number));

        await waitForBackgroundWork();
        const messages = await prisma.followupMessage.findMany({ where: { threadId: res.body.threadId } });
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({ role: 'assistant', content: 'Default question?' });
    });

    it('still logs the symptom (with a fallback question) when the model is down', async () => {
        const { setLlmClient } = await import('../src/llm/client.js');
        setLlmClient({ chat: async () => { throw new Error('connection refused'); } });
        const u = await makePatient();
        const res = await api(u).post(`/users/${u.id}/symptoms`).send(valid);
        expect(res.status).toBe(201);

        await waitForBackgroundWork();
        const [m] = await prisma.followupMessage.findMany({ where: { threadId: res.body.threadId } });
        expect(m.role).toBe('assistant');
        expect(m.content).toMatch(/\?$/);
    });

    it('accepts a back-dated loggedAt', async () => {
        const u = await makePatient();
        const res = await api(u).post(`/users/${u.id}/symptoms`).send({ ...valid, loggedAt: '2026-11-10T08:00:00Z' });
        expect(res.status).toBe(201);
        expect(res.body.loggedAt).toBe('2026-11-10T08:00:00.000Z');
    });

    it.each([
        ['intensity 0', { intensity: 0 }],
        ['intensity 6', { intensity: 6 }],
        ['fractional intensity', { intensity: 3.5 }],
        ['unknown frequency', { frequency: 'sometimes' }],
        ['empty name', { name: '' }],
        ['negative duration', { durationMinutes: -5 }],
        ['future loggedAt', { loggedAt: '2099-01-01T00:00:00Z' }],
        ['malformed loggedAt', { loggedAt: 'yesterday' }],
        ['userId in body', { userId: 5 }],
    ])('rejects %s', async (_label, patch) => {
        const u = await makePatient();
        const res = await api(u).post(`/users/${u.id}/symptoms`).send({ ...valid, ...patch });
        expect(res.status).toBe(400);
        expect(await prisma.symptom.count()).toBe(0);
    });

    it('only the patient can log a symptom for themselves', async () => {
        const medic = await makeMedic();
        const patient = await makePatient();
        const other = await makePatient();
        expect((await api(medic).post(`/users/${medic.id}/symptoms`).send(valid)).status).toBe(403);
        expect((await api(medic).post(`/users/${patient.id}/symptoms`).send(valid)).status).toBe(403);
        expect((await api(other).post(`/users/${patient.id}/symptoms`).send(valid)).status).toBe(403);
        expect((await api(patient).post('/users/999/symptoms').send(valid)).status).toBe(403);
        expect((await api().post(`/users/${patient.id}/symptoms`).send(valid)).status).toBe(401);
        expect(await prisma.symptom.count()).toBe(0);
    });
});

describe('GET /users/:id/symptoms', () => {
    it('lists newest first, filters by date range and paginates', async () => {
        const u = await makePatient();
        const old = await makeSymptom(u.id, { name: 'Old', loggedAt: new Date('2026-11-01T00:00:00Z') });
        const mid = await makeSymptom(u.id, { name: 'Mid', loggedAt: new Date('2026-11-05T00:00:00Z') });
        const recent = await makeSymptom(u.id, { name: 'Recent', loggedAt: new Date('2026-11-10T00:00:00Z') });
        const ids = (r: { body: { id: number }[] }) => r.body.map((s) => s.id);

        expect(ids(await api(u).get(`/users/${u.id}/symptoms`))).toEqual([recent.id, mid.id, old.id]);
        expect(ids(await api(u).get(`/users/${u.id}/symptoms?from=2026-11-03T00:00:00Z`))).toEqual([recent.id, mid.id]);
        expect(ids(await api(u).get(`/users/${u.id}/symptoms?to=2026-11-03T00:00:00Z`))).toEqual([old.id]);
        expect(ids(await api(u).get(`/users/${u.id}/symptoms?limit=1&offset=1`))).toEqual([mid.id]);
    });

    it("does not include other users' symptoms", async () => {
        const a = await makePatient();
        const b = await makePatient();
        await makeSymptom(b.id);
        expect((await api(a).get(`/users/${a.id}/symptoms`)).body).toEqual([]);
        expect((await api(a).get(`/users/${b.id}/symptoms`)).status).toBe(403);
    });

    it('validates the range and the user', async () => {
        const u = await makePatient();
        expect((await api(u).get(`/users/${u.id}/symptoms?from=2026-12-01T00:00:00Z&to=2026-11-01T00:00:00Z`)).status).toBe(400);
        expect((await api(u).get(`/users/${u.id}/symptoms?from=yesterday`)).status).toBe(400);
        expect((await api(u).get('/users/999/symptoms')).status).toBe(403);
    });
});

describe('GET/PATCH/DELETE /symptoms/:id', () => {
    it('returns the symptom with summaries of its follow-up threads', async () => {
        const u = await makePatient();
        const s = await makeSymptom(u.id);
        const t = await prisma.followupThread.create({ data: { symptomId: s.id } });

        const res = await api(u).get(`/symptoms/${s.id}`);
        expect(res.status).toBe(200);
        expect(res.body.threads).toEqual([expect.objectContaining({ id: t.id, status: 'open', closedAt: null })]);
        expect(res.body.threads[0]).not.toHaveProperty('messages');
    });

    it('patches fields; null clears notes and duration', async () => {
        const u = await makePatient();
        const s = await makeSymptom(u.id, { notes: 'x', durationMinutes: 30 });
        const res = await api(u).patch(`/symptoms/${s.id}`).send({ intensity: 4, notes: null, durationMinutes: null });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ intensity: 4, notes: null, durationMinutes: null, name: 'Headache' });
    });

    it('rejects bad patches', async () => {
        const u = await makePatient();
        const s = await makeSymptom(u.id);
        expect((await api(u).patch(`/symptoms/${s.id}`).send({})).status).toBe(400);
        expect((await api(u).patch(`/symptoms/${s.id}`).send({ intensity: 0 })).status).toBe(400);
        expect((await api(u).patch(`/symptoms/${s.id}`).send({ userId: 2 })).status).toBe(400);
    });

    it('404s for missing symptoms and 403s for somebody else\'s', async () => {
        const u = await makePatient();
        const other = await makePatient();
        const s = await makeSymptom(other.id);
        expect((await api(u).get('/symptoms/999')).status).toBe(404);
        expect((await api(u).patch('/symptoms/999').send({ name: 'x' })).status).toBe(404);
        expect((await api(u).delete('/symptoms/999')).status).toBe(404);
        expect((await api(u).get(`/symptoms/${s.id}`)).status).toBe(403);
        expect((await api(u).patch(`/symptoms/${s.id}`).send({ name: 'x' })).status).toBe(403);
        expect((await api(u).delete(`/symptoms/${s.id}`)).status).toBe(403);
        expect(await prisma.symptom.count({ where: { id: s.id, name: 'Headache' } })).toBe(1);
    });

    it('deletes a symptom together with its threads and messages', async () => {
        const u = await makePatient();
        const s = await makeSymptom(u.id);
        const t = await prisma.followupThread.create({ data: { symptomId: s.id } });
        await prisma.followupMessage.create({ data: { threadId: t.id, role: 'assistant', content: 'q?' } });

        await api(u).delete(`/symptoms/${s.id}`).expect(204);
        expect(await prisma.followupThread.count()).toBe(0);
        expect(await prisma.followupMessage.count()).toBe(0);
    });
});

describe('database constraints', () => {
    it('rejects intensity outside 1-5 even when the API is bypassed', async () => {
        const u = await makePatient();
        await expect(makeSymptom(u.id, { intensity: 9 })).rejects.toThrow(/symptoms_intensity_check|check constraint/i);
        await expect(makeSymptom(u.id, { intensity: 0 })).rejects.toThrow();
    });
});
