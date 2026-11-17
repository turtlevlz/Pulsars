import type { Test } from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { api, assignCheckup, makeMedic, makePatient, makeSymptom } from './helpers.js';

// One world, five kinds of caller, every endpoint. `patient` owns the data; `medic` has assigned
// them a check-up; `stranger` is another patient; `otherMedic` is a medic with no check-up for them.
async function world() {
    const patient = await makePatient({ name: 'Owner' });
    const stranger = await makePatient({ name: 'Stranger' });
    const medic = await makeMedic();
    const otherMedic = await makeMedic();
    const checkup = await assignCheckup(medic.id, patient.id);
    const symptom = await makeSymptom(patient.id);
    const thread = await prisma.followupThread.create({ data: { symptomId: symptom.id } });
    await prisma.followupMessage.create({ data: { threadId: thread.id, role: 'assistant', content: 'Q?' } });
    return { patient, stranger, medic, otherMedic, checkup, symptom, thread };
}
type World = Awaited<ReturnType<typeof world>>;
type Client = ReturnType<typeof api>;

// Expected status per caller: [anonymous, stranger, otherMedic, medic, patient].
// 'ok' means "got past the guards", whatever the endpoint itself then answers.
type Expected = number | 'ok';
type Row = [label: string, call: (c: Client, w: World) => Test, expected: [Expected, Expected, Expected, Expected, Expected]];

const rows: Row[] = [
    // reading a patient's data: the patient, and a medic who has assigned them a check-up
    ['GET /users/:id', (c, w) => c.get(`/users/${w.patient.id}`), [401, 403, 403, 'ok', 'ok']],
    ['GET /users/:id/vitals', (c, w) => c.get(`/users/${w.patient.id}/vitals?type=hr`), [401, 403, 403, 'ok', 'ok']],
    ['GET /users/:id/vitals/latest', (c, w) => c.get(`/users/${w.patient.id}/vitals/latest`), [401, 403, 403, 'ok', 'ok']],
    ['GET /users/:id/vitals/summary', (c, w) => c.get(`/users/${w.patient.id}/vitals/summary`), [401, 403, 403, 'ok', 'ok']],
    ['GET /users/:id/checkups', (c, w) => c.get(`/users/${w.patient.id}/checkups`), [401, 403, 403, 'ok', 'ok']],
    ['GET /users/:id/threads', (c, w) => c.get(`/users/${w.patient.id}/threads`), [401, 403, 403, 'ok', 'ok']],
    ['GET /symptoms/:id/threads', (c, w) => c.get(`/symptoms/${w.symptom.id}/threads`), [401, 403, 403, 'ok', 'ok']],
    ['GET /threads/:id', (c, w) => c.get(`/threads/${w.thread.id}`), [401, 403, 403, 'ok', 'ok']],
    ['GET /checkups/:id', (c, w) => c.get(`/checkups/${w.checkup.id}`), [401, 403, 403, 'ok', 'ok']],

    ['GET /users/:id/vitals/trend', (c, w) => c.get(`/users/${w.patient.id}/vitals/trend?type=hr`), [401, 403, 403, 'ok', 'ok']],
    // the symptom log is read-only for a medic who follows the patient
    ['GET /users/:id/symptoms', (c, w) => c.get(`/users/${w.patient.id}/symptoms`), [401, 403, 403, 'ok', 'ok']],
    ['GET /symptoms/:id', (c, w) => c.get(`/symptoms/${w.symptom.id}`), [401, 403, 403, 'ok', 'ok']],

    // fitness windows come from the same wearable as vitals, so they follow the same read rule
    ['GET /users/:id/fitness/calendar', (c, w) => c.get(`/users/${w.patient.id}/fitness/calendar?month=2026-10&timeZone=UTC`), [401, 403, 403, 'ok', 'ok']],
    ['GET /users/:id/fitness/day', (c, w) => c.get(`/users/${w.patient.id}/fitness/day?date=2026-10-01&timeZone=UTC`), [401, 403, 403, 'ok', 'ok']],
    ['GET /users/:id/fitness/routines', (c, w) => c.get(`/users/${w.patient.id}/fitness/routines?timeZone=UTC`), [401, 403, 403, 'ok', 'ok']],

    // health metrics: the tiers, the alerts and the manual logs follow the same read rule as vitals
    ['GET /users/:id/metrics/status', (c, w) => c.get(`/users/${w.patient.id}/metrics/status`), [401, 403, 403, 'ok', 'ok']],
    ['GET /users/:id/alerts', (c, w) => c.get(`/users/${w.patient.id}/alerts`), [401, 403, 403, 'ok', 'ok']],
    ['GET /users/:id/logs', (c, w) => c.get(`/users/${w.patient.id}/logs`), [401, 403, 403, 'ok', 'ok']],
    // the thresholds themselves are not patient data: any signed-in user
    ['GET /metrics/config', (c) => c.get('/metrics/config'), [401, 'ok', 'ok', 'ok', 'ok']],
    // acknowledging an alert: only the medic who follows the patient (a patient cannot dismiss their own warning)
    [
        'POST /users/:id/alerts/acknowledge',
        (c, w) => c.post(`/users/${w.patient.id}/alerts/acknowledge`).send({ ruleId: 'spo2', startedAt: '2026-11-14T10:00:00Z' }),
        [401, 403, 403, 'ok', 403],
    ],

    // the medic dashboard's patient list: any medic, nobody else
    ['GET /patients/search', (c) => c.get('/patients/search?q=ow'), [401, 403, 'ok', 'ok', 403]],
    ['GET /patients/overview', (c) => c.get('/patients/overview'), [401, 403, 'ok', 'ok', 403]],

    // writing: only the patient, never a medic
    [
        'PUT /users/:id/fitness/routines/:key/completion',
        (c, w) => c.put(`/users/${w.patient.id}/fitness/routines/mobility/completion`).send({ timeZone: 'UTC' }),
        [401, 403, 403, 403, 'ok'],
    ],
    ['POST /users/:id/vitals', (c, w) => c.post(`/users/${w.patient.id}/vitals`).send({ type: 'hr', value: 70 }), [401, 403, 403, 403, 'ok']],
    [
        'POST /users/:id/logs',
        (c, w) =>
            c.post(`/users/${w.patient.id}/logs`).send({
                kind: 'bp',
                value: { systolic: 118, diastolic: 76, heartRate: 68, posture: 'seated', restedFiveMinutes: true, armAtHeartLevel: true, symptoms: [] },
            }),
        [401, 403, 403, 403, 'ok'],
    ],
    ['POST /users/:id/symptoms', (c, w) => c.post(`/users/${w.patient.id}/symptoms`).send({ name: 'Cough', intensity: 2, frequency: 'daily' }), [401, 403, 403, 403, 'ok']],
    ['PATCH /symptoms/:id', (c, w) => c.patch(`/symptoms/${w.symptom.id}`).send({ intensity: 4 }), [401, 403, 403, 403, 'ok']],
    ['DELETE /symptoms/:id', (c, w) => c.delete(`/symptoms/${w.symptom.id}`), [401, 403, 403, 403, 'ok']],
    ['POST /symptoms/:id/threads', (c, w) => c.post(`/symptoms/${w.symptom.id}/threads`), [401, 403, 403, 403, 'ok']],
    ['POST /threads/:id/messages', (c, w) => c.post(`/threads/${w.thread.id}/messages`).send({ answer: 'since monday' }), [401, 403, 403, 403, 'ok']],
    [
        'PUT /checkups/:id/answers',
        (c, w) => c.put(`/checkups/${w.checkup.id}/answers`).send({ answers: [{ questionId: w.checkup.questions[0].id, answer: 'fine' }] }),
        [401, 403, 403, 403, 'ok'],
    ],

    // assigning a check-up: medics only
    [
        'POST /checkups',
        (c, w) => c.post('/checkups').send({ userId: w.patient.id, name: 'New', questions: ['How are you?'] }),
        [401, 403, 'ok', 'ok', 403],
    ],
    ['POST /users', (c) => c.post('/users').send({ name: 'New', email: 'new@test.local', password: 'longenough1' }), [401, 403, 'ok', 'ok', 403]],

    // profile edits are your own
    ['PATCH /users/:id', (c, w) => c.patch(`/users/${w.patient.id}`).send({ name: 'Renamed' }), [401, 403, 403, 403, 'ok']],
    ['DELETE /users/:id', (c, w) => c.delete(`/users/${w.patient.id}`), [401, 403, 403, 403, 'ok']],
];

describe('who can reach what', () => {
    it.each(rows)('%s', async (_label, call, expected) => {
        const w = await world();
        // The patient goes last: some of their calls change or delete the data the others are probed on.
        const callers: (Client | undefined)[] = [undefined, w.stranger, w.otherMedic, w.medic, w.patient].map((u) => (u ? api(u) : api()));
        const names = ['anonymous', 'stranger', 'otherMedic', 'medic', 'patient'];
        for (const [i, client] of callers.entries()) {
            const res = await call(client as Client, w);
            const want = expected[i];
            if (want === 'ok') {
                expect([401, 403], `${names[i]} should be let through, got ${res.status}`).not.toContain(res.status);
                expect(res.status, `${names[i]} got a server error`).toBeLessThan(500);
            } else {
                expect(res.status, names[i]).toBe(want);
            }
        }
    });
});

describe('what assigning a check-up changes', () => {
    it('gives a medic access to a patient from the moment they assign one, and not before', async () => {
        const w = await world();
        const read = () => api(w.otherMedic).get(`/users/${w.patient.id}/vitals/latest`);
        expect((await read()).status).toBe(403);
        expect((await api(w.otherMedic).get(`/users/${w.patient.id}/threads`)).status).toBe(403);

        await api(w.otherMedic).post('/checkups').send({ userId: w.patient.id, name: 'Intro', questions: ['q'] }).expect(201);
        expect((await read()).status).toBe(200);
        expect((await api(w.otherMedic).get(`/users/${w.patient.id}/threads`)).status).toBe(200);
        // ...but still nothing a medic may not do
        expect((await api(w.otherMedic).post(`/users/${w.patient.id}/vitals`).send({ type: 'hr', value: 70 })).status).toBe(403);
    });

    it("never shows a medic another medic's check-up", async () => {
        const w = await world();
        await api(w.otherMedic).post('/checkups').send({ userId: w.patient.id, name: 'Intro', questions: ['q'] }).expect(201);
        const mine = await api(w.otherMedic).get(`/users/${w.patient.id}/checkups`);
        expect(mine.body.map((c: { name: string }) => c.name)).toEqual(['Intro']);
        expect((await api(w.otherMedic).get(`/checkups/${w.checkup.id}`)).status).toBe(403);
    });

    it('gives a medic no access to other medics', async () => {
        const w = await world();
        expect((await api(w.medic).get(`/users/${w.otherMedic.id}`)).status).toBe(403);
        expect((await api(w.medic).get(`/users/${w.otherMedic.id}/checkups`)).status).toBe(403);
        expect((await api(w.patient).get(`/users/${w.medic.id}`)).status).toBe(403);
    });
});
