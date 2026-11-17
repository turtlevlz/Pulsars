import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { MINUTE } from '../src/modules/metrics/types.js';
import { api, assignCheckup, makeMedic, makePatient } from './helpers.js';
import { constant, minuteBoundary, seedMotion, seedResting, seedVitals, setBaselines } from './metrics-seed.js';

async function setup() {
    const medic = await makeMedic();
    const patient = await makePatient();
    await assignCheckup(medic.id, patient.id);
    return { medic, patient };
}

type A = { ruleId: string; level: string; startedAt: string; status: string; ongoing: boolean };
const alertsOf = async (who: { token: string }, patientId: number, query = '') =>
    (await api(who).get(`/users/${patientId}/alerts${query}`)).body as A[];

describe('GET /users/:id/alerts', () => {
    it('turns 40+ resting minutes 20% above the baseline into a yellow heart-rate alert, with its action and evidence', async () => {
        const { medic, patient } = await setup();
        await setBaselines(patient.id, { hr: 66 });
        await seedResting(patient.id, 80, 60);

        const res = await api(medic).get(`/users/${patient.id}/alerts`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        const [a] = res.body;
        expect(a).toMatchObject({
            ruleId: 'hr_resting',
            kind: 'metric',
            title: 'Resting heart rate',
            level: 'yellow',
            status: 'open',
            ongoing: true,
            escalateTo: null,
            evidenceLevel: 'OUR_HEURISTIC',
            acknowledgedAt: null,
            recommendedAction: expect.stringContaining('Rest'),
        });
        expect(a.reason).toContain('more than 10% above your usual 66 bpm');
        // 10 quiet minutes make the first resting minute, 30 resting minutes make the alert: it starts
        // about 40 minutes after the data does, on the 5-minute grid
        const start = Date.parse(a.startedAt);
        const dataStart = minuteBoundary() - 60 * MINUTE;
        expect(start % (5 * MINUTE)).toBe(0);
        expect(start - dataStart).toBeGreaterThanOrEqual(39 * MINUTE);
        expect(start - dataStart).toBeLessThanOrEqual(45 * MINUTE);
        expect(a.durationMinutes).toBeGreaterThanOrEqual(15);
    });

    it('is empty when the readings are normal, and when it is only activity (not rest)', async () => {
        const { medic, patient } = await setup();
        await setBaselines(patient.id, { hr: 66 });
        await seedResting(patient.id, 67, 60);
        expect(await alertsOf(medic, patient.id)).toEqual([]);

        const other = await makePatient();
        await assignCheckup(medic.id, other.id);
        await setBaselines(other.id, { hr: 66 });
        await seedMotion(other.id, 60, 2); // moving the whole time
        await seedVitals(other.id, 'hr', constant(140, 60)); // a hard workout is not an alert
        expect(await alertsOf(medic, other.id)).toEqual([]);
    });

    it('groups a yellow that escalates to red into one alert at the higher level', async () => {
        const { medic, patient } = await setup();
        // Alerts are judged every 5 minutes on the clock, so the newest minutes of a fresh episode can
        // take up to 5 minutes to show in this list (the status tiles are immediate). End the data a
        // little way back so a judging step always falls after the escalation.
        await seedVitals(patient.id, 'bo', [...constant(97, 10), ...constant(93, 6), ...constant(85, 5)], minuteBoundary() - 8 * MINUTE);

        const alerts = await alertsOf(medic, patient.id);
        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toMatchObject({
            ruleId: 'spo2',
            level: 'red',
            escalateTo: 'crew medical officer',
            recommendedAction: expect.stringContaining('crew medical officer'),
        });
    });

    it('never raises an alert on a single bad blood-oxygen minute', async () => {
        const { medic, patient } = await setup();
        await seedVitals(patient.id, 'bo', [...constant(97, 20), 82, ...constant(97, 5)]);
        expect(await alertsOf(medic, patient.id)).toEqual([]);
    });

    it('honours the range and the status filter, and rejects bad input', async () => {
        const { medic, patient } = await setup();
        await seedVitals(patient.id, 'bo', constant(85, 12));
        const now = Date.now();
        const inRange = `from=${new Date(now - 3600_000).toISOString()}&to=${new Date(now).toISOString()}`;
        const before = `from=${new Date(now - 6 * 3600_000).toISOString()}&to=${new Date(now - 3 * 3600_000).toISOString()}`;
        expect(await alertsOf(medic, patient.id, `?${inRange}`)).toHaveLength(1);
        expect(await alertsOf(medic, patient.id, `?${before}`)).toHaveLength(0);
        expect(await alertsOf(medic, patient.id, '?status=open')).toHaveLength(1);
        expect((await api(medic).get(`/users/${patient.id}/alerts?status=nope`)).status).toBe(400);
        expect((await api(medic).get(`/users/${patient.id}/alerts?from=2026-01-01T00:00:00Z&to=2026-06-01T00:00:00Z`)).status).toBe(400);
    });

    it('lets the patient read their own alerts, but not a stranger or another medic', async () => {
        const { medic, patient } = await setup();
        await seedVitals(patient.id, 'bo', constant(85, 12));
        expect(await alertsOf(patient, patient.id)).toHaveLength(1);
        expect(await alertsOf(medic, patient.id)).toHaveLength(1);
        expect((await api(await makeMedic()).get(`/users/${patient.id}/alerts`)).status).toBe(403);
        expect((await api(await makePatient()).get(`/users/${patient.id}/alerts`)).status).toBe(403);
        expect((await api().get(`/users/${patient.id}/alerts`)).status).toBe(401);
    });
});

describe('POST /users/:id/alerts/acknowledge', () => {
    const ack = (who: { token: string }, patientId: number, body: object) => api(who).post(`/users/${patientId}/alerts/acknowledge`).send(body);

    async function withAlert() {
        const world = await setup();
        await seedVitals(world.patient.id, 'bo', constant(85, 12));
        const [alert] = await alertsOf(world.medic, world.patient.id);
        return { ...world, alert, body: { ruleId: alert.ruleId, startedAt: alert.startedAt } };
    }

    it('acknowledges an alert, keeps who and when, and is idempotent', async () => {
        const { medic, patient, body } = await withAlert();
        const res = await ack(medic, patient.id, body);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ruleId: 'spo2', status: 'acknowledged', acknowledgedBy: { id: medic.id, name: medic.name } });
        expect(res.body.acknowledgedAt).toEqual(expect.any(String));

        await ack(medic, patient.id, body).expect(200);
        expect(await prisma.alertAcknowledgement.count()).toBe(1);
        expect(await alertsOf(medic, patient.id, '?status=open')).toEqual([]);
        expect((await alertsOf(medic, patient.id))[0].status).toBe('acknowledged');
        // and the patient sees that it was seen
        expect((await alertsOf(patient, patient.id))[0].status).toBe('acknowledged');
    });

    it('keeps the first acknowledgement when a second medic repeats it', async () => {
        const { medic, patient, body } = await withAlert();
        const colleague = await makeMedic();
        await assignCheckup(colleague.id, patient.id);
        await ack(medic, patient.id, body).expect(200);
        expect((await ack(colleague, patient.id, body)).body.acknowledgedBy.id).toBe(medic.id);
    });

    it('404s for an alert that does not exist: a made-up start, the wrong rule, or the middle of one', async () => {
        const { medic, patient, alert } = await withAlert();
        const start = Date.parse(alert.startedAt);
        expect((await ack(medic, patient.id, { ruleId: 'spo2', startedAt: new Date(start + 5 * MINUTE).toISOString() })).status).toBe(404);
        expect((await ack(medic, patient.id, { ruleId: 'spo2', startedAt: new Date(start + 7 * 1000).toISOString() })).status).toBe(404);
        expect((await ack(medic, patient.id, { ruleId: 'bp', startedAt: alert.startedAt })).status).toBe(404);
        expect(await prisma.alertAcknowledgement.count()).toBe(0);
    });

    it('validates the body, and is for the following medic only', async () => {
        const { medic, patient, body } = await withAlert();
        expect((await ack(medic, patient.id, { startedAt: body.startedAt })).status).toBe(400);
        expect((await ack(medic, patient.id, { ruleId: '', startedAt: body.startedAt })).status).toBe(400);
        expect((await ack(medic, patient.id, { ...body, type: 'hr' })).status).toBe(400); // the old field is gone
        expect((await ack(medic, patient.id, { ...body, acknowledgedBy: 1 })).status).toBe(400);
        expect((await ack(patient, patient.id, body)).status).toBe(403); // a patient cannot dismiss their own warning
        expect((await ack(await makeMedic(), patient.id, body)).status).toBe(403);
        expect((await ack(await makePatient(), patient.id, body)).status).toBe(403);
        expect(await prisma.alertAcknowledgement.count()).toBe(0);
    });

    it('goes away with the patient (and keeps the record when the medic is gone)', async () => {
        const { medic, patient, body } = await withAlert();
        await ack(medic, patient.id, body).expect(200);
        await prisma.checkup.deleteMany();
        await prisma.user.delete({ where: { id: medic.id } });
        expect((await prisma.alertAcknowledgement.findFirstOrThrow()).acknowledgedBy).toBeNull();
        await prisma.user.delete({ where: { id: patient.id } });
        expect(await prisma.alertAcknowledgement.count()).toBe(0);
    });
});

describe('seeding sanity', () => {
    it('resting seed produces resting minutes the engine can use', async () => {
        const patient = await makePatient();
        await seedResting(patient.id, 70, 30);
        const res = await api(patient).get(`/users/${patient.id}/metrics/status`);
        const hr = res.body.metrics.find((m: { metricId: string }) => m.metricId === 'hr_resting');
        expect(hr.level).toBe('green');
        expect(hr.value).toBe(70);
    });
});
