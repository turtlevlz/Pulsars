import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { REFRESH_MS } from '../src/modules/metrics/baselines.js';
import { computeHrBaseline, computeTempCurve, motionState, restingMinutes } from '../src/modules/metrics/dataset.js';
import { MINUTE, type MotionState } from '../src/modules/metrics/types.js';
import { api, assignCheckup, makeMedic, makePatient } from './helpers.js';
import { constant, minuteBoundary, seedMotion, seedResting, seedVitals, setBaselines } from './metrics-seed.js';

type Metric = {
    metricId: string;
    level: string;
    reason: string;
    value: number | null;
    measuredAt: string | null;
    ageMinutes: number | null;
    evidenceLevel: string;
    action: string | null;
    quality: { motionArtifact: boolean | null; coverage: number | null; note: string | null };
    baseline: { value: number | null; label: string } | null;
};
const statusOf = async (who: { token: string }, patientId: number) => {
    const res = await api(who).get(`/users/${patientId}/metrics/status`);
    expect(res.status).toBe(200);
    return res.body as { metrics: Metric[]; rules: { ruleId: string; level: string }[]; alerts: { ruleId: string; level: string }[]; profile: { id: string; gravity: boolean }; disclaimer: string };
};
const tier = (s: { metrics: Metric[] }, id: string) => s.metrics.find((m) => m.metricId === id)!;

describe('GET /metrics/config', () => {
    it('serves the thresholds, evidence and explanations to any signed-in user', async () => {
        const patient = await makePatient();
        const res = await api(patient).get('/metrics/config');
        expect(res.status).toBe(200);
        expect(res.body.disclaimer).toMatch(/not NASA limits/);
        expect(res.body.metrics.map((m: { metric_id: string }) => m.metric_id)).toContain('hr_resting');
        expect(res.body.metrics[0]).toMatchObject({ evidence_level: 'OUR_HEURISTIC', params: { red_high: 120, red_low: 40 } });
        expect(res.body.profiles.map((p: { id: string }) => p.id)).toEqual(['station', 'spacecraft', 'rover', 'moon', 'mars']);
        expect((await api(await makeMedic()).get('/metrics/config')).status).toBe(200);
        expect((await api().get('/metrics/config')).status).toBe(401);
    });
});

describe('GET /users/:id/metrics/status', () => {
    it('gives every metric a tier with the reason, data age, sensor quality and evidence label', async () => {
        const patient = await makePatient();
        await setBaselines(patient.id, { hr: 66, temp: 33 });
        await seedResting(patient.id, 80, 45);
        await seedVitals(patient.id, 'bt', constant(34, 40));
        await seedVitals(patient.id, 'bo', constant(97, 10));

        const s = await statusOf(patient, patient.id);
        expect(s.profile).toMatchObject({ id: 'station', gravity: false });
        expect(s.disclaimer).toMatch(/not NASA limits/);
        expect(s.metrics.map((m) => m.metricId)).toEqual(['hr_resting', 'skin_temp', 'spo2', 'bp', 'sleep', 'symptoms']);

        expect(tier(s, 'hr_resting')).toMatchObject({
            level: 'yellow',
            value: 80,
            evidenceLevel: 'OUR_HEURISTIC',
            action: expect.stringContaining('Rest'),
            baseline: { value: 66 },
            quality: { motionArtifact: false, coverage: expect.any(Number) },
        });
        expect(tier(s, 'hr_resting').ageMinutes).toBeLessThanOrEqual(2);
        expect(tier(s, 'skin_temp')).toMatchObject({ level: 'yellow', action: expect.stringContaining('thermometer') });
        expect(tier(s, 'spo2')).toMatchObject({ level: 'green', value: 97, evidenceLevel: 'CLINICAL_GUIDELINE' });
        expect(tier(s, 'bp').level).toBe('gray'); // nothing logged: unknown, not green
        expect(tier(s, 'sleep').level).toBe('gray');
        expect(tier(s, 'symptoms').level).toBe('green');
        expect(s.alerts.map((a) => a.ruleId).sort()).toEqual(['hr_resting', 'skin_temp']);
    });

    it('is gray, not green, when there is no data at all', async () => {
        const patient = await makePatient();
        const s = await statusOf(patient, patient.id);
        expect(s.metrics.filter((m) => m.level === 'green').map((m) => m.metricId)).toEqual(['symptoms']);
        expect(tier(s, 'hr_resting').reason).toMatch(/No heart-rate readings/);
        expect(s.alerts).toEqual([]);
    });

    it('decays to gray when the readings stop', async () => {
        const patient = await makePatient();
        await seedVitals(patient.id, 'bo', constant(97, 10), minuteBoundary() - 20 * MINUTE);
        const s = await statusOf(patient, patient.id);
        expect(tier(s, 'spo2').level).toBe('gray');
        expect(tier(s, 'spo2').reason).toMatch(/No blood-oxygen data for/);
    });

    it('skips blood-oxygen minutes with motion instead of judging them', async () => {
        const patient = await makePatient();
        await seedMotion(patient.id, 10, 3); // vigorous motion
        await seedVitals(patient.id, 'bo', constant(85, 10));
        const s = await statusOf(patient, patient.id);
        expect(tier(s, 'spo2').level).toBe('gray');
        expect(tier(s, 'spo2').quality.motionArtifact).toBe(true);
    });

    it('without any motion data the heart rate stays gray and says so', async () => {
        const patient = await makePatient();
        await seedVitals(patient.id, 'hr', constant(75, 40));
        const s = await statusOf(patient, patient.id);
        expect(tier(s, 'hr_resting')).toMatchObject({ level: 'gray', quality: { note: 'no motion data' } });
    });

    it('turns on the orthostatic check only when the environment has gravity', async () => {
        const patient = await makePatient();
        expect((await statusOf(patient, patient.id)).metrics.map((m) => m.metricId)).not.toContain('orthostatic');
        await api(patient).patch(`/users/${patient.id}`).send({ environmentProfile: 'moon' }).expect(200);
        const moon = await statusOf(patient, patient.id);
        expect(moon.profile).toMatchObject({ id: 'moon', gravity: true });
        expect(moon.metrics.map((m) => m.metricId)).toContain('orthostatic');
    });

    it('who can read it: the patient and the medic who follows them', async () => {
        const patient = await makePatient();
        const medic = await makeMedic();
        await assignCheckup(medic.id, patient.id);
        await statusOf(patient, patient.id);
        await statusOf(medic, patient.id);
        expect((await api(await makeMedic()).get(`/users/${patient.id}/metrics/status`)).status).toBe(403);
        expect((await api(await makePatient()).get(`/users/${patient.id}/metrics/status`)).status).toBe(403);
        expect((await api().get(`/users/${patient.id}/metrics/status`)).status).toBe(401);
    });
});

describe('personal baselines', () => {
    it('are worked out from the person\'s own resting data, stored, and reused for 15 minutes', async () => {
        const patient = await makePatient();
        // resting at 70 bpm from 12 hours ago to 7 hours ago (the last 6 hours are left out of the baseline)
        const end = minuteBoundary() - 7 * 60 * MINUTE;
        await seedMotion(patient.id, 300, 0, end);
        await seedVitals(patient.id, 'hr', constant(70, 300), end);

        const first = await statusOf(patient, patient.id);
        const rows = await prisma.baseline.findMany({ where: { userId: patient.id }, orderBy: { metricId: 'asc' } });
        expect(rows.map((r) => r.metricId)).toEqual(['bp', 'hr_resting', 'skin_temp']);
        const hr = rows.find((r) => r.metricId === 'hr_resting')!;
        expect(hr.value).toMatchObject({ established: true, median: 70 });
        expect(hr.rule).toMatch(/7-day median/);
        expect(rows.find((r) => r.metricId === 'skin_temp')!.value).toMatchObject({ established: false });
        expect(first.metrics.length).toBeGreaterThan(0);

        // a second read reuses the rows ...
        await statusOf(patient, patient.id);
        expect((await prisma.baseline.findUniqueOrThrow({ where: { userId_metricId: { userId: patient.id, metricId: 'hr_resting' } } })).updatedAt).toEqual(hr.updatedAt);
        // ... until they are older than 15 minutes
        await prisma.baseline.updateMany({ where: { userId: patient.id }, data: { updatedAt: new Date(Date.now() - REFRESH_MS - MINUTE) } });
        await statusOf(patient, patient.id);
        expect((await prisma.baseline.findUniqueOrThrow({ where: { userId_metricId: { userId: patient.id, metricId: 'hr_resting' } } })).updatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it('the skin-temperature curve needs a few days of data', async () => {
        const patient = await makePatient();
        const hours = 4 * 24;
        const end = minuteBoundary() - 25 * 60 * MINUTE; // the last 24 hours are left out
        await prisma.bodyTemp.createMany({
            data: Array.from({ length: hours * 60 }, (_, i) => ({
                userId: patient.id,
                bodyTemp: 33 + 0.5 * Math.sin(((((end - (hours * 60 - i) * MINUTE) / 3600_000) % 24) / 24) * 2 * Math.PI),
                recordedAt: new Date(end - (hours * 60 - i) * MINUTE),
            })),
        });
        await statusOf(patient, patient.id);
        const row = await prisma.baseline.findUniqueOrThrow({ where: { userId_metricId: { userId: patient.id, metricId: 'skin_temp' } } });
        const v = row.value as { established: boolean; byHour: number[]; days: number };
        expect(v.established).toBe(true);
        expect(v.byHour).toHaveLength(24);
        expect(Math.max(...v.byHour) - Math.min(...v.byHour)).toBeGreaterThan(0.6); // a day/night curve, not one number
    });

    it('computeHrBaseline / computeTempCurve: the pure edges', () => {
        const t = (m: number) => m * MINUTE;
        const hr = Array.from({ length: 40 }, (_, i) => ({ t: t(i), value: 60 + i }));
        const rest = new Set(hr.map((p) => p.t));
        expect(computeHrBaseline(hr, rest, 0, t(100), { baseline_min_resting_minutes: 30 })).toMatchObject({ median: 79.5, restingMinutes: 40 });
        expect(computeHrBaseline(hr, rest, 0, t(100), { baseline_min_resting_minutes: 41 })).toBeNull();
        expect(computeHrBaseline(hr, new Set([t(1)]), 0, t(100), { baseline_min_resting_minutes: 30 })).toBeNull();
        expect(computeHrBaseline(hr, rest, 0, t(10), { baseline_min_resting_minutes: 30 })).toBeNull(); // window ends before the data
        expect(computeTempCurve([{ t: 0, value: 33 }], 0, 1e12, { baseline_min_days: 3, baseline_min_minutes_per_hour: 1 })).toBeNull();
    });

    it('restingMinutes: still for 10 minutes in a row, this minute included', () => {
        const motion = new Map<number, MotionState>();
        for (let m = 0; m < 12; m++) motion.set(m * MINUTE, 'quiet');
        motion.set(12 * MINUTE, 'active');
        for (let m = 13; m < 25; m++) motion.set(m * MINUTE, 'quiet');
        const rest = [...restingMinutes(motion, 10)].map((x) => x / MINUTE);
        expect(rest).toEqual([9, 10, 11, 22, 23, 24]);
    });

    it('motionState: too few seconds say nothing, 90% still is quiet, anything more restless is active', () => {
        const p = { min_tracked_seconds_per_minute: 30, quiet_fraction: 0.9 };
        expect(motionState({ t: 0, tracked: 20, quiet: 20, active: 0 }, p)).toBeNull();
        expect(motionState({ t: 0, tracked: 60, quiet: 60, active: 0 }, p)).toBe('quiet');
        expect(motionState({ t: 0, tracked: 60, quiet: 54, active: 6 }, p)).toBe('quiet');
        expect(motionState({ t: 0, tracked: 60, quiet: 53, active: 7 }, p)).toBe('active');
        expect(motionState({ t: 0, tracked: 60, quiet: 40, active: 20 }, p)).toBe('active');
    });
});

describe('GET /users/:id/vitals/trend', () => {
    it('gives the dashed limit from the config, none for skin temperature, and the baseline band where there is one', async () => {
        const patient = await makePatient();
        await setBaselines(patient.id, { hr: 70, temp: 33 });
        await seedVitals(patient.id, 'hr', constant(72, 20));
        await seedVitals(patient.id, 'bt', constant(33.2, 20));
        await seedVitals(patient.id, 'bo', constant(97, 20));
        const get = async (type: string) => (await api(patient).get(`/users/${patient.id}/vitals/trend?type=${type}`)).body;

        const hr = await get('hr');
        expect(hr.threshold).toMatchObject({ bound: 'upper', limit: 100 });
        expect(hr.baseline[0]).toMatchObject({ low: 63, high: 77 }); // 70 +/- 10%
        const bt = await get('bt');
        expect(bt.threshold).toBeNull();
        expect(bt.baseline[0]).toMatchObject({ low: 32.5, high: 33.5 });
        const bo = await get('bo');
        expect(bo.threshold).toMatchObject({ bound: 'lower', limit: 95 });
        expect(bo.baseline).toBeNull();
    });

    it('has no band until a baseline is established', async () => {
        const patient = await makePatient();
        await seedVitals(patient.id, 'hr', constant(72, 20));
        expect((await api(patient).get(`/users/${patient.id}/vitals/trend?type=hr`)).body.baseline).toBeNull();
    });
});
