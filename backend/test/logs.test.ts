import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { api, assignCheckup, makeMedic, makePatient, makeSymptom } from './helpers.js';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const bpBody = (over: object = {}) => ({
    kind: 'bp',
    value: { systolic: 118, diastolic: 76, heartRate: 68, posture: 'seated', restedFiveMinutes: true, armAtHeartLevel: true, symptoms: [], ...over },
});
const post = (who: { token: string }, patientId: number, body: object) => api(who).post(`/users/${patientId}/logs`).send(body);

describe('POST /users/:id/logs', () => {
    it('stores a blood-pressure entry with its mean arterial pressure', async () => {
        const patient = await makePatient();
        const res = await post(patient, patient.id, { ...bpBody(), recordedAt: ago(10) });
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ kind: 'bp', derived: { map: 90 }, value: { systolic: 118, diastolic: 76, posture: 'seated' } });
        expect(new Date(res.body.recordedAt).getTime()).toBeGreaterThan(Date.now() - 11 * 60_000);
        expect(await prisma.logEntry.count({ where: { userId: patient.id } })).toBe(1);
    });

    it('stores sleep at the moment of waking, core temperature, exercise', async () => {
        const patient = await makePatient();
        const wake = ago(30);
        const sleep = await post(patient, patient.id, { kind: 'sleep', value: { bedtime: ago(30 + 7 * 60), wakeTime: wake, quality: 4 } });
        expect(sleep.status).toBe(201);
        expect(sleep.body.recordedAt).toBe(wake);
        expect((await post(patient, patient.id, { kind: 'core_temp', value: { celsius: 37.1, site: 'oral' } })).status).toBe(201);
        expect((await post(patient, patient.id, { kind: 'exercise', value: { done: true, minutes: 45 } })).status).toBe(201);
        expect((await post(patient, patient.id, { kind: 'exercise', value: { done: false } })).status).toBe(201);
    });

    it('validates what a person could get wrong', async () => {
        const patient = await makePatient();
        const bad = async (body: object) => expect((await post(patient, patient.id, body)).status).toBe(400);
        await bad({ kind: 'bp', value: { ...bpBody().value, systolic: 70, diastolic: 80 } }); // systolic below diastolic
        await bad(bpBody({ systolic: 400 }));
        await bad(bpBody({ posture: 'upside-down' }));
        await bad(bpBody({ symptoms: ['made_up'] }));
        await bad(bpBody({ restedFiveMinutes: undefined })); // rest must be said, not assumed
        await bad({ ...bpBody(), recordedAt: new Date(Date.now() + 3600_000).toISOString() }); // the future
        await bad({ ...bpBody(), extra: 1 });
        await bad({ kind: 'nope', value: {} });
        await bad({ kind: 'sleep', value: { bedtime: ago(10), wakeTime: ago(100) } }); // wake before bed
        await bad({ kind: 'sleep', value: { bedtime: ago(30 + 25 * 60), wakeTime: ago(30) } }); // 25 hours
        await bad({ kind: 'sleep', recordedAt: ago(5), value: { bedtime: ago(500), wakeTime: ago(30) } }); // the night has no separate time
        await bad({ kind: 'core_temp', value: { celsius: 45, site: 'oral' } });
        await bad({ kind: 'core_temp', value: { celsius: 37, site: 'armpit' } });
        await bad({ kind: 'exercise', value: { done: 'yes' } });
        expect(await prisma.logEntry.count()).toBe(0);
    });

    it('allows the orthostatic check only in an environment with gravity', async () => {
        const patient = await makePatient();
        const reading = { systolic: 118, diastolic: 74, heartRate: 64 };
        const body = { kind: 'orthostatic', value: { supine: reading, standing1: { ...reading, systolic: 96 }, standing3: { ...reading, systolic: 94 }, symptoms: [] } };
        const refused = await post(patient, patient.id, body);
        expect(refused.status).toBe(400);
        expect(refused.body.error).toMatch(/environments with gravity/);
        await api(patient).patch(`/users/${patient.id}`).send({ environmentProfile: 'mars' }).expect(200);
        expect((await post(patient, patient.id, body)).status).toBe(201);
    });

    it('is the patient only: not a medic, not a stranger, not anonymous', async () => {
        const patient = await makePatient();
        const medic = await makeMedic();
        await assignCheckup(medic.id, patient.id);
        expect((await post(medic, patient.id, bpBody())).status).toBe(403);
        expect((await post(await makePatient(), patient.id, bpBody())).status).toBe(403);
        expect((await post(await makeMedic(), patient.id, bpBody())).status).toBe(403);
        expect((await api().post(`/users/${patient.id}/logs`).send(bpBody())).status).toBe(401);
    });
});

describe('GET /users/:id/logs', () => {
    it('lists newest first, filters by kind and range, and pages', async () => {
        const patient = await makePatient();
        for (const m of [300, 200, 100]) await post(patient, patient.id, { ...bpBody({ systolic: 100 + m / 10 }), recordedAt: ago(m) }).expect(201);
        await post(patient, patient.id, { kind: 'core_temp', value: { celsius: 36.9, site: 'oral' }, recordedAt: ago(150) }).expect(201);

        const all = (await api(patient).get(`/users/${patient.id}/logs`)).body;
        expect(all.map((l: { kind: string }) => l.kind)).toEqual(['bp', 'core_temp', 'bp', 'bp']);
        const bps = (await api(patient).get(`/users/${patient.id}/logs?kind=bp`)).body;
        expect(bps.map((l: { value: { systolic: number } }) => l.value.systolic)).toEqual([110, 120, 130]);
        const page = (await api(patient).get(`/users/${patient.id}/logs?kind=bp&limit=1&offset=1`)).body;
        expect(page.map((l: { value: { systolic: number } }) => l.value.systolic)).toEqual([120]);
        const ranged = (await api(patient).get(`/users/${patient.id}/logs?from=${ago(250)}&to=${ago(120)}`)).body;
        expect(ranged).toHaveLength(2);
        expect((await api(patient).get(`/users/${patient.id}/logs?kind=nope`)).status).toBe(400);
        expect((await api(patient).get(`/users/${patient.id}/logs?limit=0`)).status).toBe(400);
    });

    it('is readable by the patient and the medic who follows them, and nobody else', async () => {
        const patient = await makePatient();
        const medic = await makeMedic();
        await assignCheckup(medic.id, patient.id);
        await post(patient, patient.id, bpBody()).expect(201);
        expect((await api(medic).get(`/users/${patient.id}/logs`)).body).toHaveLength(1);
        expect((await api(await makeMedic()).get(`/users/${patient.id}/logs`)).status).toBe(403);
        expect((await api(await makePatient()).get(`/users/${patient.id}/logs`)).status).toBe(403);
        expect((await api().get(`/users/${patient.id}/logs`)).status).toBe(401);
    });

    it('goes away with the patient', async () => {
        const patient = await makePatient();
        await post(patient, patient.id, bpBody()).expect(201);
        await prisma.user.delete({ where: { id: patient.id } });
        expect(await prisma.logEntry.count()).toBe(0);
    });
});

describe('logs feed the tiers', () => {
    const tierOf = async (who: { token: string }, id: number, metric: string) => {
        const res = await api(who).get(`/users/${id}/metrics/status`);
        return res.body.metrics.find((m: { metricId: string }) => m.metricId === metric);
    };

    it('low blood pressure with dizziness is red, and a normal reading afterwards clears it', async () => {
        const patient = await makePatient();
        await post(patient, patient.id, { ...bpBody({ systolic: 84, diastolic: 54, symptoms: ['dizziness'] }), recordedAt: ago(20) }).expect(201);
        expect(await tierOf(patient, patient.id, 'bp')).toMatchObject({ level: 'red', value: 84, evidenceLevel: 'CLINICAL_GUIDELINE', display: expect.stringContaining('MAP 64') });
        await post(patient, patient.id, { ...bpBody(), recordedAt: ago(2) }).expect(201);
        expect((await tierOf(patient, patient.id, 'bp')).level).toBe('green');
    });

    it('a logged core temperature of 38 or more makes the skin-temperature tile red', async () => {
        const patient = await makePatient();
        await post(patient, patient.id, { kind: 'core_temp', value: { celsius: 38.2, site: 'oral' } }).expect(201);
        expect(await tierOf(patient, patient.id, 'skin_temp')).toMatchObject({ level: 'red', flags: ['core_fever'] });
    });

    it('a week of short nights makes sleep red', async () => {
        const patient = await makePatient();
        for (let d = 0; d < 5; d++) {
            const wake = Date.now() - (d * 24 * 60 + 30) * 60_000;
            await post(patient, patient.id, { kind: 'sleep', value: { bedtime: new Date(wake - 5 * 3600_000).toISOString(), wakeTime: new Date(wake).toISOString() } }).expect(201);
        }
        expect(await tierOf(patient, patient.id, 'sleep')).toMatchObject({ level: 'red', value: 5 });
    });

    it('a chest-pain symptom makes the symptoms tile red, under its old name too', async () => {
        const patient = await makePatient();
        await makeSymptom(patient.id, { name: 'Chest discomfort', intensity: 1, loggedAt: new Date(Date.now() - 600_000) });
        expect(await tierOf(patient, patient.id, 'symptoms')).toMatchObject({ level: 'red', flags: ['red_flag'] });
    });
});

describe('PATCH /users/:id environmentProfile', () => {
    it('accepts the configured profiles and refuses others', async () => {
        const patient = await makePatient();
        expect((await api(patient).get(`/users/${patient.id}`)).body.environmentProfile).toBe('station');
        for (const id of ['spacecraft', 'rover', 'moon', 'mars', 'station']) {
            expect((await api(patient).patch(`/users/${patient.id}`).send({ environmentProfile: id })).body.environmentProfile).toBe(id);
        }
        expect((await api(patient).patch(`/users/${patient.id}`).send({ environmentProfile: 'jupiter' })).status).toBe(400);
        expect((await api(patient).patch(`/users/${patient.id}`).send({ environmentProfile: 3 })).status).toBe(400);
        expect((await api(await makePatient()).patch(`/users/${patient.id}`).send({ environmentProfile: 'moon' })).status).toBe(403);
    });
});
