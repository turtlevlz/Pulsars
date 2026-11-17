import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { api, assignCheckup, makeMedic, makePatient } from './helpers.js';

describe('GET /patients/search', () => {
    it('finds patients by part of their name, case-insensitively, with only id and name', async () => {
        const medic = await makeMedic();
        const anna = await makePatient({ name: 'Anna Lindqvist' });
        await makePatient({ name: 'Bob Stone' });
        await makeMedic({ name: 'Annabel Medic' }); // medics are not patients

        const res = await api(medic).get('/patients/search?q=ANN');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([{ id: anna.id, name: 'Anna Lindqvist' }]);
    });

    it('does not accept wildcards or one-letter searches as a way to list everyone', async () => {
        const medic = await makeMedic();
        await makePatient({ name: 'Anna' });
        await makePatient({ name: 'Bob' });
        expect((await api(medic).get('/patients/search?q=a')).status).toBe(400);
        expect((await api(medic).get('/patients/search?q=__')).status).toBe(400);
        expect((await api(medic).get('/patients/search?q=%25%25')).status).toBe(400);
        expect((await api(medic).get('/patients/search')).status).toBe(400);
        expect((await api(medic).get('/patients/search?q=%25an')).body).toHaveLength(1);
    });

    it('caps the number of results', async () => {
        const medic = await makeMedic();
        for (let i = 0; i < 25; i++) await makePatient({ name: `Sam ${i}` });
        expect((await api(medic).get('/patients/search?q=sam')).body).toHaveLength(20);
    });

    it('is for medics only', async () => {
        const patient = await makePatient();
        expect((await api(patient).get('/patients/search?q=ab')).status).toBe(403);
        expect((await api().get('/patients/search?q=ab')).status).toBe(401);
    });
});

describe('GET /patients/overview', () => {
    it("lists the medic's own patients with their last reading and open alerts", async () => {
        const medic = await makeMedic();
        const colleague = await makeMedic();
        const a = await makePatient({ name: 'Alice' });
        const b = await makePatient({ name: 'Bob' });
        const c = await makePatient({ name: 'Carol' });
        await assignCheckup(medic.id, a.id);
        await assignCheckup(medic.id, b.id);
        await assignCheckup(colleague.id, c.id);

        const last = new Date(Date.now() - 3 * 60_000);
        await prisma.heartRate.create({ data: { userId: a.id, heartRate: 70, recordedAt: new Date(Date.now() - 10 * 60_000) } });
        await prisma.bodyTemp.create({ data: { userId: a.id, bodyTemp: 33, recordedAt: last } });
        // Bob: ten minutes of blood oxygen below 90%, a few hours ago
        const start = Math.floor((Date.now() - 4 * 3600_000) / 60_000) * 60_000;
        await prisma.bloodOxygen.createMany({
            data: Array.from({ length: 10 }, (_, m) => [0, 30].map((s) => ({ userId: b.id, bloodO: 85, recordedAt: new Date(start + m * 60_000 + s * 1000) }))).flat(),
        });

        const res = await api(medic).get('/patients/overview');
        expect(res.status).toBe(200);
        expect(res.body.map((p: { name: string }) => p.name)).toEqual(['Alice', 'Bob']);
        expect(res.body[0]).toMatchObject({ id: a.id, age: 30, openAlerts: 0, openAlertLevel: null });
        expect(new Date(res.body[0].lastReadingAt).getTime()).toBe(last.getTime());
        // a red alert (blood oxygen below 90% three minutes in a row) is open, and it is the worst level
        expect(res.body[1]).toMatchObject({ id: b.id, openAlerts: 1, openAlertLevel: 'red' });

        const [alert] = (await api(medic).get(`/users/${b.id}/alerts`)).body;
        await api(medic).post(`/users/${b.id}/alerts/acknowledge`).send({ ruleId: alert.ruleId, startedAt: alert.startedAt }).expect(200);
        expect((await api(medic).get('/patients/overview')).body[1]).toMatchObject({ openAlerts: 0, openAlertLevel: null });
    });

    it('is empty for a medic with no patients, and for medics only', async () => {
        const medic = await makeMedic();
        expect((await api(medic).get('/patients/overview')).body).toEqual([]);
        expect((await api(await makePatient()).get('/patients/overview')).status).toBe(403);
    });
});
