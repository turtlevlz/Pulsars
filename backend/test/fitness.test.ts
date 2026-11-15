import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { handleMessage } from '../src/mqtt/subscriber.js';
import { makeMedic, makePatient } from './helpers.js';

function sample(acceleration = 0.01, rotation = 1, pulse: number | null = null, skin: number | null = null) {
    return { motion_rms_g: acceleration, gyro_rms_dps: rotation, pulse_bpm: pulse, skin_temp_c: skin };
}

function packet(at: string, samples: (ReturnType<typeof sample> | null)[], uptime = 1000) {
    return { v: 1, deviceId: 'test-cuff', bootId: 'boot-one', deviceTimeMs: uptime, recordedAt: at, samples };
}

function publish(userId: number, data: unknown) {
    return handleMessage(`pulsars/${userId}/fitness/window`, JSON.stringify(data));
}

function path(userId: number, route: string) {
    return `/users/${userId}/fitness/${route}`;
}

describe('Fitness', () => {
    it('distinguishes no readings from measured quiet time and ignores isolated bumps', async () => {
        const user = await makePatient();
        const day = path(user.id, 'day');
        const query = { date: '2026-10-01', timeZone: 'UTC' };
        const empty = await request(app).get(day).query(query).expect(200);
        expect(empty.body).toMatchObject({ activeSeconds: 0, trackedSeconds: 0, lastReadingAt: null, timeline: [] });

        const samples = Array.from({ length: 10 }, () => sample());
        samples[4] = sample(0.5);
        expect(await publish(user.id, packet('2026-10-01T12:00:00Z', samples))).toBe('stored');
        const quiet = await request(app).get(day).query(query).expect(200);
        expect(quiet.body).toMatchObject({
            activeSeconds: 0, trackedSeconds: 10, lastReadingAt: '2026-10-01T12:00:09.000Z',
            timeline: [{ kind: 'quiet', startedAt: '2026-10-01T12:00:00.000Z', endedAt: '2026-10-01T12:00:10.000Z' }],
        });
    });

    it.each([
        ['America/Phoenix', '2026-11-01T06:59:55Z', '2026-10-31', '2026-11-01'],
        ['America/New_York', '2026-11-02T04:59:55Z', '2026-11-01', '2026-11-02'],
        ['America/New_York', '2026-03-09T03:59:55Z', '2026-03-08', '2026-03-09'],
    ])('counts each motion band across local midnight in %s', async (timeZone, at, before, after) => {
        const user = await makePatient();
        const samples = [...Array.from({ length: 5 }, () => sample(0.06)),
            ...Array.from({ length: 3 }, () => sample(0.01, 35)), sample(0.35), sample(0.01, 80)];
        const data = packet(at, samples);
        const deliveries = await Promise.all([publish(user.id, data), publish(user.id, data)]);
        expect(deliveries.sort()).toEqual(['duplicate', 'stored']);

        for (const [date, intensity] of [[before, { light: 5, moderate: 0, high: 0 }],
            [after, { light: 0, moderate: 3, high: 2 }]] as const) {
            const month = date.slice(0, 7);
            const expected = { date, activeSeconds: 5, trackedSeconds: 5, intensity };
            const daily = await request(app).get(path(user.id, 'day')).query({ date, timeZone }).expect(200);
            const calendar = await request(app).get(path(user.id, 'calendar')).query({ month, timeZone }).expect(200);
            expect(daily.body).toMatchObject(expected);
            expect(calendar.body.days).toContainEqual(expected);
        }
    });

    it('shows timed sensor context and marks missing motion between windows as a gap', async () => {
        const user = await makePatient();
        const quiet = Array.from({ length: 10 }, () => sample());
        quiet[9] = sample(0, 0, 71, 31.5);
        const movement = [...Array.from({ length: 5 }, () => sample(0.16, 0, null, 32)), ...Array(5).fill(null)];
        for (const [at, samples, uptime] of [
            ['2026-10-05T12:00:00Z', quiet, 1000],
            ['2026-10-05T12:00:10Z', movement, 11000],
            ['2026-10-05T12:00:30Z', quiet, 31000],
        ] as const) {
            expect(await publish(user.id, packet(at, samples, uptime))).toBe('stored');
        }
        const res = await request(app).get(path(user.id, 'day')).query({ date: '2026-10-05', timeZone: 'UTC' }).expect(200);
        expect(res.body).toMatchObject({ trackedSeconds: 25, activeSeconds: 5 });
        expect(res.body.timeline).toMatchObject([
            { kind: 'quiet' },
            {
                kind: 'activity', band: 'moderate', activeSeconds: 5,
                pulse: { value: 71, recordedAt: '2026-10-05T12:00:09.000Z', relation: 'before' },
                skinTemperature: { value: 32, recordedAt: '2026-10-05T12:00:10.000Z', relation: 'during' },
            },
            { kind: 'gap', startedAt: '2026-10-05T12:00:15.000Z', endedAt: '2026-10-05T12:00:30.000Z' },
            { kind: 'quiet' },
        ]);
    });

    it('groups quiet windows across gaps of up to 30 seconds and keeps longer gaps separate', async () => {
        const user = await makePatient();
        const still = Array.from({ length: 10 }, () => sample());
        const stillWithPulse = [...still];
        stillWithPulse[0] = sample(0, 0, 69, 32);
        for (const [at, samples, uptime] of [
            ['2026-10-08T01:00:00Z', still, 1000],
            ['2026-10-08T01:00:20Z', stillWithPulse, 21000],
            ['2026-10-08T01:01:00Z', still, 61000],
            ['2026-10-08T01:01:41Z', still, 102000],
        ] as const) {
            expect(await publish(user.id, packet(at, samples, uptime))).toBe('stored');
        }

        const result = await request(app).get(path(user.id, 'day'))
            .query({ date: '2026-10-08', timeZone: 'UTC' }).expect(200);
        expect(result.body).toMatchObject({
            activeSeconds: 0,
            trackedSeconds: 40,
            timeline: [
                {
                    kind: 'quiet', startedAt: '2026-10-08T01:00:00.000Z', endedAt: '2026-10-08T01:01:10.000Z',
                    gapSeconds: 40,
                    pulse: { value: 69, recordedAt: '2026-10-08T01:00:20.000Z', relation: 'during' },
                    skinTemperature: { value: 32, recordedAt: '2026-10-08T01:00:20.000Z', relation: 'during' },
                },
                { kind: 'gap', startedAt: '2026-10-08T01:01:10.000Z', endedAt: '2026-10-08T01:01:41.000Z' },
                { kind: 'quiet', startedAt: '2026-10-08T01:01:41.000Z', endedAt: '2026-10-08T01:01:51.000Z', gapSeconds: 0 },
            ],
        });
    });

    it('rejects malformed windows and restricts ingestion to real patient IDs', async () => {
        const [patient, medic] = await Promise.all([makePatient(), makeMedic()]);
        const data = packet('2026-10-15T00:00:00Z', Array.from({ length: 10 }, () => sample()));
        expect(await publish(patient.id, { ...data, samples: [] })).toBe('dropped');
        expect(await publish(patient.id, { ...data, samples: [sample(-1), ...data.samples.slice(1)] })).toBe('dropped');
        expect(await publish(patient.id, { ...data, samples: [sample(0, 0, 300), ...data.samples.slice(1)] })).toBe('dropped');
        expect(await publish(medic.id, data)).toBe('dropped');
        expect(await publish(2147483647, data)).toBe('dropped');
        await request(app).get(path(patient.id, 'calendar')).query({ month: '2026-10', timeZone: 'not/a-zone' }).expect(400);
        await request(app).get(path(patient.id, 'day')).query({ date: '2026-02-30', timeZone: 'UTC' }).expect(400);
        await request(app).get(path(medic.id, 'routines')).query({ timeZone: 'UTC' }).expect(400);
    });

    it.each(['before', 'after'] as const)('includes valid sensor context %s an activity across midnight', async (relation) => {
        const user = await makePatient();
        const moving = Array.from({ length: 10 }, () => sample(0.16));
        const still = Array.from({ length: 10 }, () => sample(0, 0, 72, 33));
        const before = relation === 'before';
        expect(await publish(user.id, packet('2026-10-21T23:59:50Z', before ? still : moving))).toBe('stored');
        expect(await publish(user.id, packet('2026-10-22T00:00:00Z', before ? moving : still, 11000))).toBe('stored');

        const result = await request(app).get(path(user.id, 'day'))
            .query({ date: before ? '2026-10-22' : '2026-10-21', timeZone: 'UTC' }).expect(200);
        expect(result.body).toMatchObject({
            activeSeconds: 10, trackedSeconds: 10,
            timeline: [{
                kind: 'activity',
                pulse: {
                    value: 72, relation, recordedAt: before ? '2026-10-21T23:59:59.000Z' : '2026-10-22T00:00:00.000Z',
                },
                skinTemperature: { value: 33, relation },
            }],
        });
    });

    it('persists one manual completion per routine and local day and includes it on the timeline', async () => {
        const user = await makePatient();
        const timeZone = 'America/Phoenix';
        const routines = await request(app).get(path(user.id, 'routines')).query({ timeZone }).expect(200);
        expect(routines.body.routines.map((routine: { key: string }) => routine.key)).toEqual([
            'mobility', 'light-cardio', 'steady-cardio', 'resistance',
        ]);
        expect(routines.body.routines).toMatchObject([
            { key: 'mobility', steps: expect.arrayContaining([expect.stringMatching(/15 seconds/)]) },
            { key: 'light-cardio', steps: expect.arrayContaining([expect.stringMatching(/6 minutes/)]) },
            { key: 'steady-cardio', steps: expect.arrayContaining([expect.stringMatching(/9 minutes/)]) },
            {
                key: 'resistance',
                steps: expect.arrayContaining([expect.stringMatching(/2 sets of 8.*30 seconds/)]),
            },
        ]);
        const endpoint = path(user.id, 'routines/mobility/completion');
        const first = await request(app).put(endpoint).send({ timeZone }).expect(200);
        const second = await request(app).put(endpoint).send({ timeZone }).expect(200);
        expect(second.body).toEqual(first.body);
        expect(await prisma.routineCompletion.count()).toBe(1);
        const refreshed = await request(app).get(path(user.id, 'routines')).query({ timeZone }).expect(200);
        expect(refreshed.body.routines.find((routine: { key: string }) => routine.key === 'mobility')).toMatchObject({
            completedAt: first.body.completedAt,
        });
        const calendarDay = await request(app).get(path(user.id, 'day')).query({ date: first.body.date, timeZone }).expect(200);
        expect(calendarDay.body).toMatchObject({
            activeSeconds: 0, trackedSeconds: 0, timeline: [{ kind: 'routine', title: 'Mobility', completedAt: first.body.completedAt }],
        });
    });
});
