import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { api, assignCheckup, makeMedic, makePatient, makeSymptom } from './helpers.js';

const valid = { name: 'Carol', email: 'carol@test.local', password: 'hunter2hunter2', age: 29, weight: 60, height: 165 };

describe('POST /users (a medic creates an account)', () => {
    it('creates a patient by default, hashes the password and never returns secrets', async () => {
        const medic = await makeMedic();
        const res = await api(medic).post('/users').send(valid);
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ name: 'Carol', email: 'carol@test.local', role: 'patient', age: 29, hrCount: 0, avgHr: null });
        expect(res.body).not.toHaveProperty('passwordHash');
        expect(res.body).not.toHaveProperty('tokenVersion');
        expect(res.body).not.toHaveProperty('password');

        const row = await prisma.user.findUniqueOrThrow({ where: { id: res.body.id } });
        expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
        expect(row.passwordHash).not.toContain('hunter2');
    });

    it('can create a medic', async () => {
        const medic = await makeMedic();
        const res = await api(medic).post('/users').send({ name: 'Dr. X', email: 'x@test.local', password: 'longenough1', role: 'medic' });
        expect(res.status).toBe(201);
        expect(res.body.role).toBe('medic');
    });

    it('stores the email lower-cased and refuses a duplicate regardless of case', async () => {
        const medic = await makeMedic();
        const first = await api(medic).post('/users').send({ ...valid, email: '  Carol@Test.Local ' });
        expect(first.status).toBe(201);
        expect(first.body.email).toBe('carol@test.local');
        expect((await api(medic).post('/users').send({ ...valid, email: 'CAROL@test.local' })).status).toBe(409);
    });

    it('is refused for patients and for anonymous callers', async () => {
        const patient = await makePatient();
        expect((await api(patient).post('/users').send(valid)).status).toBe(403);
        expect((await api().post('/users').send(valid)).status).toBe(401);
        expect(await prisma.user.count()).toBe(1);
    });

    it.each([
        ['short password', { password: 'short' }],
        ['password over 72 bytes', { password: 'é'.repeat(37) }],
        ['empty name', { name: '  ' }],
        ['missing email', { email: undefined }],
        ['bad email', { email: 'not-an-email' }],
        ['unknown role', { role: 'admin' }],
        ['negative age', { age: -1 }],
        ['absurd weight', { weight: 5000 }],
        ['server-managed field', { avgHr: 50 }],
        ['server-managed counter', { hrCount: 10 }],
        ['session counter', { tokenVersion: 5 }],
    ])('rejects %s', async (_label, patch) => {
        const medic = await makeMedic();
        const res = await api(medic).post('/users').send({ ...valid, ...patch });
        expect(res.status).toBe(400);
        expect(await prisma.user.count()).toBe(1);
    });
});

describe('GET /users', () => {
    it('shows a patient only themselves', async () => {
        const a = await makePatient({ name: 'A' });
        await makePatient({ name: 'B' });
        await makeMedic();

        const res = await api(a).get('/users');
        expect(res.status).toBe(200);
        expect(res.body.map((u: { id: number }) => u.id)).toEqual([a.id]);
        expect(res.body.every((u: object) => !('passwordHash' in u) && !('tokenVersion' in u))).toBe(true);
    });

    it('shows a medic themselves and the patients they assigned a check-up to', async () => {
        const medic = await makeMedic();
        const other = await makeMedic();
        const mine = await makePatient({ name: 'Mine' });
        const theirs = await makePatient({ name: 'Theirs' });
        await makePatient({ name: 'Unrelated' });
        await assignCheckup(medic.id, mine.id);
        await assignCheckup(other.id, theirs.id);

        const all = await api(medic).get('/users');
        expect(all.body.map((u: { id: number }) => u.id)).toEqual([medic.id, mine.id]);

        const patients = await api(medic).get('/users?role=patient');
        expect(patients.body.map((u: { id: number }) => u.id)).toEqual([mine.id]);

        const page = await api(medic).get('/users?limit=1&offset=1');
        expect(page.body.map((u: { id: number }) => u.id)).toEqual([mine.id]);
    });

    it('rejects a bad role filter and anonymous callers', async () => {
        const medic = await makeMedic();
        expect((await api(medic).get('/users?role=admin')).status).toBe(400);
        expect((await api().get('/users')).status).toBe(401);
    });
});

describe('GET /users/:id', () => {
    it('returns your own profile without secrets', async () => {
        const u = await makePatient();
        const res = await api(u).get(`/users/${u.id}`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id: u.id, email: u.email });
        expect(res.body).not.toHaveProperty('passwordHash');
        expect(res.body).not.toHaveProperty('tokenVersion');
    });

    it("lets a medic read a patient's profile once they have assigned a check-up, not before", async () => {
        const medic = await makeMedic();
        const patient = await makePatient();
        expect((await api(medic).get(`/users/${patient.id}`)).status).toBe(403);
        await assignCheckup(medic.id, patient.id);
        expect((await api(medic).get(`/users/${patient.id}`)).status).toBe(200);
    });

    it("refuses other people's profiles, whether they exist or not", async () => {
        const a = await makePatient();
        const b = await makePatient();
        const medic = await makeMedic();
        expect((await api(a).get(`/users/${b.id}`)).status).toBe(403);
        expect((await api(a).get(`/users/${medic.id}`)).status).toBe(403);
        expect((await api(a).get('/users/999')).status).toBe(403);
    });

    it('400s for a bad id', async () => {
        const u = await makePatient();
        expect((await api(u).get('/users/abc')).status).toBe(400);
    });
});

describe('PATCH /users/:id', () => {
    it('updates fields and null clears optional ones', async () => {
        const u = await makePatient();
        const res = await api(u).patch(`/users/${u.id}`).send({ weight: 66.5, age: null });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ weight: 66.5, age: null, name: u.name });
    });

    it('changes the email (normalised) and refuses one that is taken', async () => {
        const u = await makePatient();
        const other = await makePatient();
        const ok = await api(u).patch(`/users/${u.id}`).send({ email: 'New.Address@Test.Local' });
        expect(ok.status).toBe(200);
        expect(ok.body.email).toBe('new.address@test.local');
        expect((await api(u).patch(`/users/${u.id}`).send({ email: other.email })).status).toBe(409);
    });

    it('no longer changes the password here (that is POST /auth/password)', async () => {
        const u = await makePatient();
        expect((await api(u).patch(`/users/${u.id}`).send({ password: 'a-brand-new-one' })).status).toBe(400);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash).toBe('x');
    });

    it('does not allow changing role or server-managed fields', async () => {
        const u = await makePatient();
        expect((await api(u).patch(`/users/${u.id}`).send({ role: 'medic' })).status).toBe(400);
        expect((await api(u).patch(`/users/${u.id}`).send({ avgHr: 1 })).status).toBe(400);
        expect((await api(u).patch(`/users/${u.id}`).send({ tokenVersion: 9 })).status).toBe(400);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe('patient');
    });

    it('rejects an empty update', async () => {
        const u = await makePatient();
        expect((await api(u).patch(`/users/${u.id}`).send({})).status).toBe(400);
    });

    it("only edits your own profile, even for a medic with that patient", async () => {
        const medic = await makeMedic();
        const patient = await makePatient({ name: 'Before' });
        await assignCheckup(medic.id, patient.id);
        expect((await api(medic).patch(`/users/${patient.id}`).send({ name: 'Hacked' })).status).toBe(403);
        expect((await api(patient).patch(`/users/${medic.id}`).send({ name: 'Hacked' })).status).toBe(403);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: patient.id } })).name).toBe('Before');
    });
});

describe('DELETE /users/:id', () => {
    it('lets a patient delete their own account together with their data', async () => {
        const medic = await makeMedic();
        const u = await makePatient();
        await makeSymptom(u.id);
        await prisma.heartRate.create({ data: { userId: u.id, heartRate: 70, recordedAt: new Date() } });
        await assignCheckup(medic.id, u.id);

        await api(u).delete(`/users/${u.id}`).expect(204);
        expect(await prisma.symptom.count()).toBe(0);
        expect(await prisma.heartRate.count()).toBe(0);
        expect(await prisma.checkup.count()).toBe(0);
        expect(await prisma.question.count()).toBe(0);
        // The token outlives the account for a moment, but it no longer opens anything.
        await api(u).get(`/users/${u.id}`).expect(401);
    });

    it('refuses to delete a medic who still has assigned check-ups', async () => {
        const medic = await makeMedic();
        const patient = await makePatient();
        await assignCheckup(medic.id, patient.id);

        const res = await api(medic).delete(`/users/${medic.id}`);
        expect(res.status).toBe(409);
        expect(await prisma.user.count({ where: { id: medic.id } })).toBe(1);
    });

    it("never deletes somebody else's account", async () => {
        const medic = await makeMedic();
        const patient = await makePatient();
        await assignCheckup(medic.id, patient.id);
        expect((await api(medic).delete(`/users/${patient.id}`)).status).toBe(403);
        expect((await api(patient).delete(`/users/${medic.id}`)).status).toBe(403);
        expect(await prisma.user.count()).toBe(2);
    });
});
