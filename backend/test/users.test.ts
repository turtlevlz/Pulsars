import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { api, makeMedic, makePatient, makeSymptom } from './helpers.js';

const valid = { name: 'Carol', password: 'hunter2hunter2', age: 29, weight: 60, height: 165 };

describe('POST /users', () => {
    it('creates a patient by default, hashes the password and never returns the hash', async () => {
        const res = await api().post('/users').send(valid);
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ name: 'Carol', role: 'patient', age: 29, hrCount: 0, avgHr: null });
        expect(res.body).not.toHaveProperty('passwordHash');
        expect(res.body).not.toHaveProperty('password');

        const row = await prisma.user.findUniqueOrThrow({ where: { id: res.body.id } });
        expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
        expect(row.passwordHash).not.toContain('hunter2');
    });

    it('can create a medic', async () => {
        const res = await api().post('/users').send({ name: 'Dr. X', password: 'longenough1', role: 'medic' });
        expect(res.status).toBe(201);
        expect(res.body.role).toBe('medic');
    });

    it.each([
        ['short password', { password: 'short' }],
        ['empty name', { name: '  ' }],
        ['unknown role', { role: 'admin' }],
        ['negative age', { age: -1 }],
        ['absurd weight', { weight: 5000 }],
        ['server-managed field', { avgHr: 50 }],
        ['server-managed counter', { hrCount: 10 }],
    ])('rejects %s', async (_label, patch) => {
        const res = await api().post('/users').send({ ...valid, ...patch });
        expect(res.status).toBe(400);
        expect(await prisma.user.count()).toBe(0);
    });
});

describe('GET /users', () => {
    it('lists users, filters by role and paginates', async () => {
        await makeMedic();
        const a = await makePatient({ name: 'A' });
        const b = await makePatient({ name: 'B' });

        const all = await api().get('/users');
        expect(all.body).toHaveLength(3);
        expect(all.body.every((u: object) => !('passwordHash' in u))).toBe(true);

        const patients = await api().get('/users?role=patient');
        expect(patients.body.map((u: { id: number }) => u.id)).toEqual([a.id, b.id]);

        const page = await api().get('/users?limit=1&offset=2');
        expect(page.body.map((u: { id: number }) => u.id)).toEqual([b.id]);
    });

    it('rejects a bad role filter', async () => {
        expect((await api().get('/users?role=admin')).status).toBe(400);
    });
});

describe('GET /users/:id', () => {
    it('returns the user', async () => {
        const u = await makePatient();
        const res = await api().get(`/users/${u.id}`);
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(u.id);
        expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('404s for a missing user and 400s for a bad id', async () => {
        expect((await api().get('/users/999')).status).toBe(404);
        expect((await api().get('/users/abc')).status).toBe(400);
    });
});

describe('PATCH /users/:id', () => {
    it('updates fields and null clears optional ones', async () => {
        const u = await makePatient();
        const res = await api().patch(`/users/${u.id}`).send({ weight: 66.5, age: null });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ weight: 66.5, age: null, name: u.name });
    });

    it('re-hashes a new password', async () => {
        const u = await makePatient();
        await api().patch(`/users/${u.id}`).send({ password: 'a-brand-new-one' }).expect(200);
        const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
        expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
    });

    it('does not allow changing role or server-managed fields', async () => {
        const u = await makePatient();
        expect((await api().patch(`/users/${u.id}`).send({ role: 'medic' })).status).toBe(400);
        expect((await api().patch(`/users/${u.id}`).send({ avgHr: 1 })).status).toBe(400);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe('patient');
    });

    it('rejects an empty update and 404s for a missing user', async () => {
        const u = await makePatient();
        expect((await api().patch(`/users/${u.id}`).send({})).status).toBe(400);
        expect((await api().patch('/users/999').send({ name: 'x' })).status).toBe(404);
    });
});

describe('DELETE /users/:id', () => {
    it('deletes a patient together with their data', async () => {
        const medic = await makeMedic();
        const u = await makePatient();
        await makeSymptom(u.id);
        await prisma.heartRate.create({ data: { userId: u.id, heartRate: 70, recordedAt: new Date() } });
        await prisma.checkup.create({ data: { userId: u.id, medicId: medic.id, name: 'c', questions: { create: [{ question: 'q' }] } } });

        await api().delete(`/users/${u.id}`).expect(204);
        expect(await prisma.symptom.count()).toBe(0);
        expect(await prisma.heartRate.count()).toBe(0);
        expect(await prisma.checkup.count()).toBe(0);
        expect(await prisma.question.count()).toBe(0);
        await api().get(`/users/${u.id}`).expect(404);
    });

    it('refuses to delete a medic who still has assigned check-ups', async () => {
        const medic = await makeMedic();
        const patient = await makePatient();
        await prisma.checkup.create({ data: { userId: patient.id, medicId: medic.id, name: 'c' } });

        const res = await api().delete(`/users/${medic.id}`);
        expect(res.status).toBe(409);
        expect(await prisma.user.count({ where: { id: medic.id } })).toBe(1);
    });

    it('404s for a missing user', async () => {
        expect((await api().delete('/users/999')).status).toBe(404);
    });
});
