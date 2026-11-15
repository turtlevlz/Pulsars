import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { api, makeMedic, makePatient } from './helpers.js';

const post = (userId: number, body: object) => api().post(`/users/${userId}/vitals`).send(body);
const at = (i: number) => new Date(Date.UTC(2026, 10, 14, 10, 0, i)).toISOString(); // i seconds after 10:00:00Z
const user = (id: number) => prisma.user.findUniqueOrThrow({ where: { id } });

describe('POST /users/:id/vitals', () => {
    it('stores readings and keeps a lifetime average per vital', async () => {
        const u = await makePatient();
        for (const [i, v] of [70, 80, 90].entries()) {
            const res = await post(u.id, { type: 'hr', value: v, recordedAt: at(i) });
            expect(res.status).toBe(201);
            expect(res.body.stored).toBe(true);
        }
        await post(u.id, { type: 'bt', value: 36.6, recordedAt: at(0) });
        await post(u.id, { type: 'bt', value: 37.4, recordedAt: at(1) });
        await post(u.id, { type: 'bo', value: 98, recordedAt: at(0) });

        expect(await user(u.id)).toMatchObject({ avgHr: 80, hrCount: 3, btCount: 2, boCount: 1, avgBo: 98 });
        expect((await user(u.id)).avgBt).toBeCloseTo(37, 10);
    });

    it('the first reading becomes the average', async () => {
        const u = await makePatient();
        await post(u.id, { type: 'hr', value: 64, recordedAt: at(0) });
        expect(await user(u.id)).toMatchObject({ avgHr: 64, hrCount: 1, avgBt: null, btCount: 0 });
    });

    it('skips a duplicate (same user and timestamp): 200, nothing stored, average unchanged', async () => {
        const u = await makePatient();
        await post(u.id, { type: 'hr', value: 70, recordedAt: at(0) }).expect(201);
        const dup = await post(u.id, { type: 'hr', value: 200, recordedAt: at(0) });
        expect(dup.status).toBe(200);
        expect(dup.body.stored).toBe(false);
        expect(await prisma.heartRate.count()).toBe(1);
        expect(await user(u.id)).toMatchObject({ avgHr: 70, hrCount: 1 });
    });

    it('the same timestamp is fine for a different vital or a different user', async () => {
        const a = await makePatient();
        const b = await makePatient();
        expect((await post(a.id, { type: 'hr', value: 70, recordedAt: at(0) })).status).toBe(201);
        expect((await post(a.id, { type: 'bt', value: 36.6, recordedAt: at(0) })).status).toBe(201);
        expect((await post(b.id, { type: 'hr', value: 70, recordedAt: at(0) })).status).toBe(201);
    });

    it('defaults recordedAt to now', async () => {
        const u = await makePatient();
        const res = await post(u.id, { type: 'bo', value: 97 });
        expect(Math.abs(Date.parse(res.body.recordedAt) - Date.now())).toBeLessThan(5000);
    });

    it.each([
        ['hr too high', { type: 'hr', value: 251 }],
        ['hr too low', { type: 'hr', value: 19 }],
        ['bt too low', { type: 'bt', value: 29.9 }],
        ['bt too high', { type: 'bt', value: 45.1 }],
        ['bo too high', { type: 'bo', value: 100.5 }],
        ['bo too low', { type: 'bo', value: 49 }],
        ['unknown type', { type: 'xx', value: 70 }],
        ['string value', { type: 'hr', value: '70' }],
        ['future timestamp', { type: 'hr', value: 70, recordedAt: '2099-01-01T00:00:00Z' }],
        ['malformed timestamp', { type: 'hr', value: 70, recordedAt: 'noon' }],
        ['client-supplied average', { type: 'hr', value: 70, avg: 1 }],
    ])('rejects %s and changes nothing', async (_label, body) => {
        const u = await makePatient();
        expect((await post(u.id, body)).status).toBe(400);
        expect(await prisma.heartRate.count()).toBe(0);
        expect(await user(u.id)).toMatchObject({ hrCount: 0, btCount: 0, boCount: 0 });
    });

    it('accepts values at the edge of the allowed range', async () => {
        const u = await makePatient();
        expect((await post(u.id, { type: 'hr', value: 20, recordedAt: at(0) })).status).toBe(201);
        expect((await post(u.id, { type: 'hr', value: 250, recordedAt: at(1) })).status).toBe(201);
        expect((await post(u.id, { type: 'bo', value: 100, recordedAt: at(2) })).status).toBe(201);
    });

    it('only patients have readings; unknown users are 404', async () => {
        const medic = await makeMedic();
        expect((await post(medic.id, { type: 'hr', value: 70 })).status).toBe(400);
        expect((await post(999, { type: 'hr', value: 70 })).status).toBe(404);
    });

    it('keeps the cached average exact under concurrent writes, duplicates included', async () => {
        const u = await makePatient();
        const values = Array.from({ length: 40 }, (_, i) => 40 + ((i * 37) % 150));
        const jobs = [
            ...values.map((v, i) => post(u.id, { type: 'hr', value: v, recordedAt: at(i) })),
            // duplicates racing the originals for timestamps 0..9
            ...Array.from({ length: 10 }, (_, i) => post(u.id, { type: 'hr', value: 249, recordedAt: at(i) })),
        ];
        const results = await Promise.all(jobs);
        expect(results.filter((r) => r.status === 201)).toHaveLength(40);
        expect(results.filter((r) => r.status === 200)).toHaveLength(10);

        const truth = await prisma.heartRate.aggregate({ where: { userId: u.id }, _avg: { heartRate: true }, _count: true });
        const row = await user(u.id);
        expect(row.hrCount).toBe(truth._count);
        expect(row.avgHr).toBeCloseTo(truth._avg.heartRate!, 9);
    });
});

describe('GET /users/:id/vitals (time series)', () => {
    async function seeded() {
        const u = await makePatient();
        for (let i = 0; i < 5; i++) await post(u.id, { type: 'hr', value: 60 + i, recordedAt: at(i * 60) }).expect(201);
        await post(u.id, { type: 'bt', value: 36.5, recordedAt: at(0) }).expect(201);
        return u;
    }

    it('returns one vital, oldest first, with its unit', async () => {
        const u = await seeded();
        const res = await api().get(`/users/${u.id}/vitals?type=hr`);
        expect(res.status).toBe(200);
        expect(res.body.type).toBe('hr');
        expect(res.body.unit).toBe('bpm');
        expect(res.body.readings.map((r: { value: number }) => r.value)).toEqual([60, 61, 62, 63, 64]);
    });

    it('limit keeps the newest readings, still oldest first', async () => {
        const u = await seeded();
        const res = await api().get(`/users/${u.id}/vitals?type=hr&limit=2`);
        expect(res.body.readings.map((r: { value: number }) => r.value)).toEqual([63, 64]);
    });

    it('filters by an inclusive time range', async () => {
        const u = await seeded();
        const res = await api().get(`/users/${u.id}/vitals?type=hr&from=${at(60)}&to=${at(120)}`);
        expect(res.body.readings.map((r: { value: number }) => r.value)).toEqual([61, 62]);
    });

    it('is empty for a user with no readings, and per-user', async () => {
        const u = await seeded();
        const other = await makePatient();
        expect((await api().get(`/users/${other.id}/vitals?type=hr`)).body.readings).toEqual([]);
        expect((await api().get(`/users/${u.id}/vitals?type=bo`)).body.readings).toEqual([]);
    });

    it('validates the query and the user', async () => {
        const u = await seeded();
        expect((await api().get(`/users/${u.id}/vitals`)).status).toBe(400); // type is required
        expect((await api().get(`/users/${u.id}/vitals?type=xx`)).status).toBe(400);
        expect((await api().get(`/users/${u.id}/vitals?type=hr&from=${at(100)}&to=${at(1)}`)).status).toBe(400);
        expect((await api().get(`/users/${u.id}/vitals?type=hr&limit=0`)).status).toBe(400);
        expect((await api().get('/users/999/vitals?type=hr')).status).toBe(404);
    });
});

describe('GET /users/:id/vitals/latest and /summary', () => {
    it('latest returns the newest reading per vital, null when there are none', async () => {
        const u = await makePatient();
        await post(u.id, { type: 'hr', value: 70, recordedAt: at(0) });
        await post(u.id, { type: 'hr', value: 75, recordedAt: at(10) });
        const res = await api().get(`/users/${u.id}/vitals/latest`);
        expect(res.body.hr).toMatchObject({ value: 75, unit: 'bpm', recordedAt: at(10) });
        expect(res.body.bt).toBeNull();
        expect(res.body.bo).toBeNull();
        expect((await api().get('/users/999/vitals/latest')).status).toBe(404);
    });

    it('summary reports count/avg/min/max per vital, optionally over a range', async () => {
        const u = await makePatient();
        for (const [i, v] of [70, 80, 90].entries()) await post(u.id, { type: 'hr', value: v, recordedAt: at(i * 60) });

        const all = await api().get(`/users/${u.id}/vitals/summary`);
        expect(all.body.hr).toEqual({ unit: 'bpm', count: 3, avg: 80, min: 70, max: 90 });
        expect(all.body.bt).toEqual({ unit: '°C', count: 0, avg: null, min: null, max: null });

        const ranged = await api().get(`/users/${u.id}/vitals/summary?from=${at(60)}`);
        expect(ranged.body.hr).toEqual({ unit: 'bpm', count: 2, avg: 85, min: 80, max: 90 });
        expect((await api().get(`/users/${u.id}/vitals/summary?from=${at(100)}&to=${at(1)}`)).status).toBe(400);
    });
});
