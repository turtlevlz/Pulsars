import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { api, assignCheckup, makeMedic, makePatient } from './helpers.js';

async function setup() {
    const medic = await makeMedic();
    const patient = await makePatient();
    const res = await api(medic)
        .post('/checkups')
        .send({ userId: patient.id, name: 'Weekly review', questions: ['Sleep?', 'Dizziness?', 'Medication?'] });
    return { medic, patient, checkup: res.body };
}

describe('POST /checkups', () => {
    it('creates a check-up with its questions in one request, assigned by the signed-in medic', async () => {
        const { medic, patient, checkup } = await setup();
        expect(checkup).toMatchObject({
            userId: patient.id,
            medicId: medic.id,
            status: 'assigned',
            completedAt: null,
            patient: { id: patient.id },
            medic: { id: medic.id },
        });
        expect(checkup.questions.map((q: { question: string }) => q.question)).toEqual(['Sleep?', 'Dizziness?', 'Medication?']);
        expect(checkup.questions.every((q: { answer: unknown }) => q.answer === null)).toBe(true);
    });

    it('accepts your own medicId but refuses to assign as another medic', async () => {
        const medic = await makeMedic();
        const other = await makeMedic();
        const patient = await makePatient();
        const body = { userId: patient.id, name: 'c', questions: ['q'] };
        expect((await api(medic).post('/checkups').send({ ...body, medicId: medic.id })).status).toBe(201);
        expect((await api(medic).post('/checkups').send({ ...body, medicId: other.id })).status).toBe(403);
        expect(await prisma.checkup.count()).toBe(1);
    });

    it('is for medics only', async () => {
        const medic = await makeMedic();
        const patient = await makePatient();
        const body = { userId: patient.id, name: 'c', questions: ['q'] };
        expect((await api(patient).post('/checkups').send({ ...body, medicId: medic.id })).status).toBe(403);
        expect((await api(patient).post('/checkups').send(body)).status).toBe(403);
        expect((await api().post('/checkups').send(body)).status).toBe(401);
        expect(await prisma.checkup.count()).toBe(0);
    });

    it('checks that the check-up is for a patient that exists', async () => {
        const medic = await makeMedic();
        const body = { name: 'c', questions: ['q'] };
        expect((await api(medic).post('/checkups').send({ ...body, userId: medic.id })).body.error).toMatch(/not a patient/);
        expect((await api(medic).post('/checkups').send({ ...body, userId: 999 })).status).toBe(404);
        expect(await prisma.checkup.count()).toBe(0);
    });

    it.each([
        ['no questions', { questions: [] }],
        ['too many questions', { questions: Array.from({ length: 51 }, (_, i) => `q${i}`) }],
        ['blank question', { questions: ['  '] }],
        ['past dueAt', { dueAt: '2020-01-01T00:00:00Z' }],
        ['missing name', { name: '' }],
        ['unknown field', { status: 'completed' }],
    ])('rejects %s', async (_label, patch) => {
        const medic = await makeMedic();
        const patient = await makePatient();
        const res = await api(medic).post('/checkups').send({ userId: patient.id, name: 'c', questions: ['q'], ...patch });
        expect(res.status).toBe(400);
        expect(await prisma.checkup.count()).toBe(0);
    });
});

describe('listing and reading', () => {
    it("lists a patient's check-ups and a medic's assigned ones, with progress counts", async () => {
        const { medic, patient, checkup } = await setup();
        const other = await makePatient({ name: 'Other' });
        await api(medic).post('/checkups').send({ userId: other.id, name: 'Second', questions: ['q'] }).expect(201);
        await api(patient).put(`/checkups/${checkup.id}/answers`).send({ answers: [{ questionId: checkup.questions[0].id, answer: 'ok' }] }).expect(200);

        const forPatient = await api(patient).get(`/users/${patient.id}/checkups`);
        expect(forPatient.body).toHaveLength(1);
        expect(forPatient.body[0]).toMatchObject({ id: checkup.id, questionCount: 3, answeredCount: 1 });
        expect(forPatient.body[0]).not.toHaveProperty('questions');

        expect((await api(medic).get(`/users/${medic.id}/checkups`)).body).toHaveLength(2);
        expect((await api(medic).get(`/users/${medic.id}/checkups?status=completed`)).body).toEqual([]);
        expect((await api(medic).get(`/users/${medic.id}/checkups?status=assigned`)).body).toHaveLength(2);
        expect((await api(medic).get('/users/999/checkups')).status).toBe(403);
    });

    it("shows a medic a patient's check-ups, but only the ones that medic assigned", async () => {
        const { medic, patient } = await setup();
        const colleague = await makeMedic();
        await assignCheckup(colleague.id, patient.id, { name: 'Colleague check' });

        const seenByMedic = await api(medic).get(`/users/${patient.id}/checkups`);
        expect(seenByMedic.status).toBe(200);
        expect(seenByMedic.body.map((c: { name: string }) => c.name)).toEqual(['Weekly review']);
        expect((await api(patient).get(`/users/${patient.id}/checkups`)).body).toHaveLength(2);
    });

    it("keeps check-up lists private to their owner (and the medic's own patients)", async () => {
        const { medic, patient } = await setup();
        const stranger = await makePatient();
        const unrelatedMedic = await makeMedic();
        expect((await api(stranger).get(`/users/${patient.id}/checkups`)).status).toBe(403);
        expect((await api(unrelatedMedic).get(`/users/${patient.id}/checkups`)).status).toBe(403);
        expect((await api(patient).get(`/users/${medic.id}/checkups`)).status).toBe(403);
        expect((await api().get(`/users/${patient.id}/checkups`)).status).toBe(401);
    });

    it('returns one check-up to its patient and to the medic who assigned it, and nobody else', async () => {
        const { medic, patient, checkup } = await setup();
        const res = await api(patient).get(`/checkups/${checkup.id}`);
        expect(res.status).toBe(200);
        expect(res.body.questions).toHaveLength(3);
        expect((await api(medic).get(`/checkups/${checkup.id}`)).status).toBe(200);

        expect((await api(await makePatient()).get(`/checkups/${checkup.id}`)).status).toBe(403);
        expect((await api(await makeMedic()).get(`/checkups/${checkup.id}`)).status).toBe(403);
        expect((await api(patient).get('/checkups/999')).status).toBe(404);
    });
});

describe('PUT /checkups/:id/answers', () => {
    const answer = (questionId: number, text = 'fine') => ({ questionId, answer: text });

    it('saves partial answers, then completes the check-up when all are answered', async () => {
        const { checkup, patient } = await setup();
        const [q1, q2, q3] = checkup.questions.map((q: { id: number }) => q.id);

        const partial = await api(patient).put(`/checkups/${checkup.id}/answers`).send({ answers: [answer(q1, 'Slept 6h')] });
        expect(partial.status).toBe(200);
        expect(partial.body.status).toBe('assigned');
        expect(partial.body.completedAt).toBeNull();

        // answers can be changed while the check-up is still open
        const overwrite = await api(patient).put(`/checkups/${checkup.id}/answers`).send({ answers: [answer(q1, 'Slept 7h'), answer(q2, 'No')] });
        expect(overwrite.body.questions[0].answer).toBe('Slept 7h');
        expect(overwrite.body.status).toBe('assigned');

        const done = await api(patient).put(`/checkups/${checkup.id}/answers`).send({ answers: [answer(q3, 'Yes')] });
        expect(done.body.status).toBe('completed');
        expect(done.body.completedAt).not.toBeNull();
    });

    it('is all-or-nothing: one invalid answer saves none of the others', async () => {
        const { checkup, medic, patient } = await setup();
        const other = await api(medic).post('/checkups').send({ userId: patient.id, name: 'Other', questions: ['x'] });
        const [q1, q2] = checkup.questions.map((q: { id: number }) => q.id);

        const res = await api(patient)
            .put(`/checkups/${checkup.id}/answers`)
            .send({ answers: [answer(q1), answer(q2), answer(other.body.questions[0].id)] });
        expect(res.status).toBe(400);
        expect(res.body.details.questionIds).toEqual([other.body.questions[0].id]);
        expect(await prisma.question.count({ where: { answer: { not: null } } })).toBe(0);
    });

    it('rejects duplicates, blank answers, empty lists and unknown questions', async () => {
        const { checkup, patient } = await setup();
        const q1 = checkup.questions[0].id;
        const put = (answers: unknown) => api(patient).put(`/checkups/${checkup.id}/answers`).send({ answers });
        expect((await put([answer(q1, 'a'), answer(q1, 'b')])).status).toBe(400);
        expect((await put([answer(q1, '  ')])).status).toBe(400);
        expect((await put([])).status).toBe(400);
        expect((await put([answer(999999)])).status).toBe(400);
        expect(await prisma.question.count({ where: { answer: { not: null } } })).toBe(0);
    });

    it('locks a completed check-up (409) and 404s for a missing one', async () => {
        const { checkup, patient } = await setup();
        const all = checkup.questions.map((q: { id: number }) => answer(q.id));
        await api(patient).put(`/checkups/${checkup.id}/answers`).send({ answers: all }).expect(200);

        const again = await api(patient).put(`/checkups/${checkup.id}/answers`).send({ answers: [answer(all[0].questionId, 'changed')] });
        expect(again.status).toBe(409);
        expect((await prisma.question.findUniqueOrThrow({ where: { id: all[0].questionId } })).answer).toBe('fine');
        expect((await api(patient).put('/checkups/999/answers').send({ answers: [answer(1)] })).status).toBe(404);
    });

    it('can only be answered by the patient it was assigned to', async () => {
        const { checkup, medic } = await setup();
        const stranger = await makePatient();
        const send = (who: { token: string }) =>
            api(who).put(`/checkups/${checkup.id}/answers`).send({ answers: [answer(checkup.questions[0].id)] });
        expect((await send(medic)).status).toBe(403);
        expect((await send(stranger)).status).toBe(403);
        expect(await prisma.question.count({ where: { answer: { not: null } } })).toBe(0);
    });
});
