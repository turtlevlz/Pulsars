import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { EXPECTED, SCENARIOS, createDemoUser, deleteDemoUsers, seedScenario, type Scenario } from '../scripts/demo-scenarios.js';
import { api, assignCheckup, makeMedic, makePatient } from './helpers.js';

// The four demo scenarios (spec section 12, question 4), run for real: seeded through the same code
// as `npm run demo`, read back through the API. If a threshold changes, this says which demo moved.

async function run(scenario: Scenario) {
    const patient = await makePatient({ name: `Demo ${scenario}` });
    await seedScenario(patient.id, scenario, { baselineDays: 4 });
    const status = (await api(patient).get(`/users/${patient.id}/metrics/status`)).body;
    return { patient, status };
}
const levels = (status: { metrics: { metricId: string; level: string }[] }) => Object.fromEntries(status.metrics.map((m) => [m.metricId, m.level]));

describe.each(SCENARIOS)('demo scenario: %s', (scenario) => {
    it('gives the tiers the demo promises', async () => {
        const { status } = await run(scenario);
        expect(levels(status), status.metrics.map((m: { metricId: string; reason: string }) => `${m.metricId}: ${m.reason}`).join('\n')).toEqual(EXPECTED[scenario].tiers);
        expect(status.rules.map((r: { ruleId: string }) => r.ruleId)).toEqual(EXPECTED[scenario].rules);
    }, 60_000);
});

describe('scenario details', () => {
    it('infection: the cross rule escalates three yellows to red, and the medic sees it as one grouped alert each', async () => {
        const { patient, status } = await run('infection');
        expect(status.rules[0]).toMatchObject({ ruleId: 'volume_loss_or_infection', level: 'red' });
        const hr = status.metrics.find((m: { metricId: string }) => m.metricId === 'hr_resting');
        expect(hr.value).toBeGreaterThan(78);
        expect(hr.baseline.value).toBeGreaterThan(64); // their own resting median (sleeping minutes pull it a little under 66)
        expect(hr.baseline.value).toBeLessThan(67);
        const temp = status.metrics.find((m: { metricId: string }) => m.metricId === 'skin_temp');
        expect(temp.reason).toContain('thermometer');
        expect(temp.level).not.toBe('red'); // the band alone is never red

        const medic = await makeMedic();
        await assignCheckup(medic.id, patient.id);
        const alerts = (await api(medic).get(`/users/${patient.id}/alerts`)).body as { ruleId: string; level: string; ongoing: boolean; escalateTo: string | null }[];
        expect(alerts.map((a) => a.ruleId).sort()).toEqual(['bp', 'hr_resting', 'skin_temp', 'volume_loss_or_infection']);
        expect(alerts.find((a) => a.ruleId === 'volume_loss_or_infection')).toMatchObject({ level: 'red', escalateTo: 'crew medical officer' });
        const roster = (await api(medic).get('/patients/overview')).body;
        expect(roster[0]).toMatchObject({ openAlertLevel: 'red' });

        // logging a thermometer reading turns the skin-temperature tile red: the one way it can be
        await api(patient).post(`/users/${patient.id}/logs`).send({ kind: 'core_temp', value: { celsius: 38.3, site: 'oral' } }).expect(201);
        const after = (await api(patient).get(`/users/${patient.id}/metrics/status`)).body;
        expect(levels(after).skin_temp).toBe('red');
    }, 60_000);

    it('sleep debt: only sleep is red, with the schedule-and-light action', async () => {
        const { status } = await run('sleep-debt');
        const sleep = status.metrics.find((m: { metricId: string }) => m.metricId === 'sleep');
        expect(sleep).toMatchObject({ level: 'red', evidenceLevel: 'SPACEFLIGHT_DATA', action: expect.stringContaining('schedule and lighting') });
        expect(sleep.value).toBeCloseTo(5.3, 1);
    }, 60_000);

    it('hypoxia: red from several minutes in a row, never one reading', async () => {
        const { patient, status } = await run('hypoxia');
        const spo2 = status.metrics.find((m: { metricId: string }) => m.metricId === 'spo2');
        expect(spo2.level).toBe('red');
        expect(spo2.reason).toContain('3 one-minute medians in a row');
        // take away all but the last minute: one low minute alone does not raise anything
        const cutoff = new Date(Date.now() - 90_000);
        await prisma.bloodOxygen.updateMany({ where: { userId: patient.id, recordedAt: { gte: new Date(Date.now() - 14 * 60_000), lt: cutoff } }, data: { bloodO: 97 } });
        const after = (await api(patient).get(`/users/${patient.id}/metrics/status`)).body;
        expect(levels(after).spo2).not.toBe('red');
    }, 60_000);

    it('orthostatic: on the Moon the check is on, with the heart-rate pattern flagged; on a station it is off', async () => {
        const { patient, status } = await run('orthostatic');
        expect(status.profile).toMatchObject({ id: 'moon', gravity: true });
        const ortho = status.metrics.find((m: { metricId: string }) => m.metricId === 'orthostatic');
        expect(ortho).toMatchObject({ level: 'yellow', flags: ['volume_or_pots_pattern'], display: '26/10 mmHg drop' });
        await api(patient).patch(`/users/${patient.id}`).send({ environmentProfile: 'station' }).expect(200);
        const station = (await api(patient).get(`/users/${patient.id}/metrics/status`)).body;
        expect(station.metrics.map((m: { metricId: string }) => m.metricId)).not.toContain('orthostatic');
    }, 60_000);
});

describe('demo users', () => {
    it('are throwaway: created apart from the seeded users and removed by cleanup, with their data', async () => {
        const alice = await makePatient({ name: 'Alice' });
        const demo = await createDemoUser('hypoxia');
        expect(demo.email).toMatch(/@pulsars\.demo$/);
        await seedScenario(demo.id, 'hypoxia', { baselineDays: 3 });
        expect(await prisma.bloodOxygen.count({ where: { userId: demo.id } })).toBe(3 * 24 * 60);
        expect(await prisma.bloodOxygen.count({ where: { userId: alice.id } })).toBe(0);

        expect(await deleteDemoUsers()).toBe(1);
        expect(await prisma.user.count({ where: { id: alice.id } })).toBe(1);
        expect(await prisma.bloodOxygen.count()).toBe(0);
        expect(await prisma.fitnessWindow.count()).toBe(0);
        expect(await prisma.logEntry.count()).toBe(0);
    }, 60_000);
});
