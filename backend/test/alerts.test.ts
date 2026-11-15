import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { api, assignCheckup, makeMedic, makePatient } from './helpers.js';

const MIN = 60_000;
// Minute-aligned, a few hours back, so the readings fall inside the default 7-day range and the episodes are over.
const base = Math.floor((Date.now() - 6 * 3600_000) / MIN) * MIN;
const minute = (m: number) => base + m * MIN;

/** One reading per 20 s for each minute in `minutes`, all at `value`. */
async function heartRates(userId: number, minutes: number[], value: number) {
    const data = minutes.flatMap((m) => [0, 20, 40].map((s) => ({ userId, heartRate: value, recordedAt: new Date(minute(m) + s * 1000) })));
    await prisma.heartRate.createMany({ data });
}
const spo2 = (userId: number, minutes: number[], value: number) =>
    prisma.bloodOxygen.createMany({
        data: minutes.flatMap((m) => [0, 30].map((s) => ({ userId, bloodO: value, recordedAt: new Date(minute(m) + s * 1000) }))),
    });

async function setup() {
    const medic = await makeMedic();
    const patient = await makePatient();
    await assignCheckup(medic.id, patient.id);
    return { medic, patient };
}

describe('GET /users/:id/alerts', () => {
    it('lists threshold episodes across the vitals, newest first, with their limits', async () => {
        const { medic, patient } = await setup();
        await heartRates(patient.id, [0, 1, 2, 3, 4], 104); // 5 minutes above 100
        await spo2(patient.id, [10, 11, 12], 90); // 3 minutes below 92
        await heartRates(patient.id, [20], 130); // a single minute: not an alert

        const res = await api(medic).get(`/users/${patient.id}/alerts`);
        expect(res.status).toBe(200);
        expect(res.body.map((a: { type: string }) => a.type)).toEqual(['bo', 'hr']);
        expect(res.body[0]).toMatchObject({ type: 'bo', unit: '%', durationMinutes: 3, peak: 90, status: 'open', acknowledgedAt: null, threshold: { bound: 'lower', limit: 92 } });
        expect(res.body[1]).toMatchObject({ type: 'hr', unit: 'bpm', durationMinutes: 5, peak: 104, status: 'open', threshold: { bound: 'upper', limit: 100 } });
        expect(res.body[1].startedAt).toBe(new Date(minute(0)).toISOString());
    });

    it('is empty when every reading is within the limits', async () => {
        const { medic, patient } = await setup();
        await heartRates(patient.id, [0, 1, 2, 3], 72);
        expect((await api(medic).get(`/users/${patient.id}/alerts`)).body).toEqual([]);
    });

    it('honours the range and the status filter', async () => {
        const { medic, patient } = await setup();
        await heartRates(patient.id, [0, 1, 2], 110);
        const inRange = `from=${new Date(minute(-5)).toISOString()}&to=${new Date(minute(10)).toISOString()}`;
        const outRange = `from=${new Date(minute(5)).toISOString()}&to=${new Date(minute(10)).toISOString()}`;
        expect((await api(medic).get(`/users/${patient.id}/alerts?${inRange}`)).body).toHaveLength(1);
        expect((await api(medic).get(`/users/${patient.id}/alerts?${outRange}`)).body).toHaveLength(0);
        expect((await api(medic).get(`/users/${patient.id}/alerts?status=open`)).body).toHaveLength(1);
        expect((await api(medic).get(`/users/${patient.id}/alerts?status=nope`)).status).toBe(400);
        expect((await api(medic).get(`/users/${patient.id}/alerts?from=2026-01-01T00:00:00Z&to=2026-06-01T00:00:00Z`)).status).toBe(400);
    });

    it('is for the medic who follows the patient only', async () => {
        const { patient } = await setup();
        const stranger = await makeMedic();
        expect((await api(patient).get(`/users/${patient.id}/alerts`)).status).toBe(403);
        expect((await api(stranger).get(`/users/${patient.id}/alerts`)).status).toBe(403);
        expect((await api().get(`/users/${patient.id}/alerts`)).status).toBe(401);
    });
});

describe('POST /users/:id/alerts/acknowledge', () => {
    const ack = (who: { token: string }, patientId: number, body: object) => api(who).post(`/users/${patientId}/alerts/acknowledge`).send(body);

    it('acknowledges an episode, keeps who and when, and is idempotent', async () => {
        const { medic, patient } = await setup();
        await heartRates(patient.id, [0, 1, 2], 110);
        const startedAt = new Date(minute(0)).toISOString();

        const res = await ack(medic, patient.id, { type: 'hr', startedAt });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ type: 'hr', status: 'acknowledged', acknowledgedBy: { id: medic.id, name: medic.name } });
        expect(res.body.acknowledgedAt).toEqual(expect.any(String));

        await ack(medic, patient.id, { type: 'hr', startedAt }).expect(200);
        expect(await prisma.alertAcknowledgement.count()).toBe(1);
        expect((await api(medic).get(`/users/${patient.id}/alerts?status=open`)).body).toEqual([]);
        expect((await api(medic).get(`/users/${patient.id}/alerts`)).body[0].status).toBe('acknowledged');
    });

    it('keeps the first acknowledgement when a second medic repeats it', async () => {
        const { medic, patient } = await setup();
        const colleague = await makeMedic();
        await assignCheckup(colleague.id, patient.id);
        await heartRates(patient.id, [0, 1, 2], 110);
        const startedAt = new Date(minute(0)).toISOString();
        await ack(medic, patient.id, { type: 'hr', startedAt }).expect(200);
        const again = await ack(colleague, patient.id, { type: 'hr', startedAt });
        expect(again.body.acknowledgedBy.id).toBe(medic.id);
    });

    it('404s for an episode that does not exist', async () => {
        const { medic, patient } = await setup();
        await heartRates(patient.id, [0, 1, 2], 110);
        expect((await ack(medic, patient.id, { type: 'hr', startedAt: new Date(minute(1)).toISOString() })).status).toBe(404); // not a start
        expect((await ack(medic, patient.id, { type: 'bo', startedAt: new Date(minute(0)).toISOString() })).status).toBe(404);
        expect(await prisma.alertAcknowledgement.count()).toBe(0);
    });

    it('validates the body and is for the following medic only', async () => {
        const { medic, patient } = await setup();
        await heartRates(patient.id, [0, 1, 2], 110);
        const body = { type: 'hr', startedAt: new Date(minute(0)).toISOString() };
        expect((await ack(medic, patient.id, { type: 'xx', startedAt: body.startedAt })).status).toBe(400);
        expect((await ack(medic, patient.id, { type: 'hr' })).status).toBe(400);
        expect((await ack(medic, patient.id, { ...body, acknowledgedBy: 1 })).status).toBe(400);
        expect((await ack(patient, patient.id, body)).status).toBe(403);
        expect((await ack(await makeMedic(), patient.id, body)).status).toBe(403);
        expect(await prisma.alertAcknowledgement.count()).toBe(0);
    });

    it('goes away with the patient (and keeps the record when the medic is gone)', async () => {
        const { medic, patient } = await setup();
        await heartRates(patient.id, [0, 1, 2], 110);
        await ack(medic, patient.id, { type: 'hr', startedAt: new Date(minute(0)).toISOString() }).expect(200);
        await prisma.checkup.deleteMany();
        await prisma.user.delete({ where: { id: medic.id } });
        expect((await prisma.alertAcknowledgement.findFirstOrThrow()).acknowledgedBy).toBeNull();
        await prisma.user.delete({ where: { id: patient.id } });
        expect(await prisma.alertAcknowledgement.count()).toBe(0);
    });
});
