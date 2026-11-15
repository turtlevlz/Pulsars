import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { api, makeMedic, makePatient } from './helpers.js';

async function setup() {
    const medic = await makeMedic();
    const patient = await makePatient();
    const res = await api()
        .post('/checkups')
        .send({ userId: patient.id, medicId: medic.id, name: 'Weekly review', questions: ['Sleep?', 'Dizziness?', 'Medication?'] });
    return { medic, patient, checkup: res.body };
}

describe('POST /checkups', () => {
    it('creates a check-up with its questions in one request', async () => {
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

    it('checks the roles of both users', async () => {
        const medic = await makeMedic();
        const patient = await makePatient();
        const body = { name: 'c', questions: ['q'] };
        expect((await api().post('/checkups').send({ ...body, userId: medic.id, medicId: medic.id })).body.error).toMatch(/not a patient/);
        expect((await api().post('/checkups').send({ ...body, userId: patient.id, medicId: patient.id })).body.error).toMatch(/not a medic/);
        expect((await api().post('/checkups').send({ ...body, userId: 999, medicId: medic.id })).status).toBe(404);
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
        const res = await api().post('/checkups').send({ userId: patient.id, medicId: medic.id, name: 'c', questions: ['q'], ...patch });
        expect(res.status).toBe(400);
        expect(await prisma.checkup.count()).toBe(0);
    });
});

describe('listing and reading', () => {
    it("lists a patient's check-ups and a medic's assigned ones, with progress counts", async () => {
        const { medic, patient, checkup } = await setup();
        const other = await makePatient({ name: 'Other' });
        await api().post('/checkups').send({ userId: other.id, medicId: medic.id, name: 'Second', questions: ['q'] }).expect(201);
        await api().put(`/checkups/${checkup.id}/answers`).send({ answers: [{ questionId: checkup.questions[0].id, answer: 'ok' }] }).expect(200);

        const forPatient = await api().get(`/users/${patient.id}/checkups`);
        expect(forPatient.body).toHaveLength(1);
        expect(forPatient.body[0]).toMatchObject({ id: checkup.id, questionCount: 3, answeredCount: 1 });
        expect(forPatient.body[0]).not.toHaveProperty('questions');

        expect((await api().get(`/users/${medic.id}/checkups`)).body).toHaveLength(2);
        expect((await api().get(`/users/${medic.id}/checkups?status=completed`)).body).toEqual([]);
        expect((await api().get(`/users/${medic.id}/checkups?status=assigned`)).body).toHaveLength(2);
        expect((await api().get('/users/999/checkups')).status).toBe(404);
    });

    it('returns one check-up with questions and 404s for a missing one', async () => {
        const { checkup } = await setup();
        const res = await api().get(`/checkups/${checkup.id}`);
        expect(res.status).toBe(200);
        expect(res.body.questions).toHaveLength(3);
        expect((await api().get('/checkups/999')).status).toBe(404);
    });
});

describe('PUT /checkups/:id/answers', () => {
    const answer = (questionId: number, text = 'fine') => ({ questionId, answer: text });

    it('saves partial answers, then completes the check-up when all are answered', async () => {
        const { checkup } = await setup();
        const [q1, q2, q3] = checkup.questions.map((q: { id: number }) => q.id);

        const partial = await api().put(`/checkups/${checkup.id}/answers`).send({ answers: [answer(q1, 'Slept 6h')] });
        expect(partial.status).toBe(200);
        expect(partial.body.status).toBe('assigned');
        expect(partial.body.completedAt).toBeNull();

        // answers can be changed while the check-up is still open
        const overwrite = await api().put(`/checkups/${checkup.id}/answers`).send({ answers: [answer(q1, 'Slept 7h'), answer(q2, 'No')] });
        expect(overwrite.body.questions[0].answer).toBe('Slept 7h');
        expect(overwrite.body.status).toBe('assigned');

        const done = await api().put(`/checkups/${checkup.id}/answers`).send({ answers: [answer(q3, 'Yes')] });
        expect(done.body.status).toBe('completed');
        expect(done.body.completedAt).not.toBeNull();
    });

    it('is all-or-nothing: one invalid answer saves none of the others', async () => {
        const { checkup, medic, patient } = await setup();
        const other = await api().post('/checkups').send({ userId: patient.id, medicId: medic.id, name: 'Other', questions: ['x'] });
        const [q1, q2] = checkup.questions.map((q: { id: number }) => q.id);

        const res = await api()
            .put(`/checkups/${checkup.id}/answers`)
            .send({ answers: [answer(q1), answer(q2), answer(other.body.questions[0].id)] });
        expect(res.status).toBe(400);
        expect(res.body.details.questionIds).toEqual([other.body.questions[0].id]);
        expect(await prisma.question.count({ where: { answer: { not: null } } })).toBe(0);
    });

    it('rejects duplicates, blank answers, empty lists and unknown questions', async () => {
        const { checkup } = await setup();
        const q1 = checkup.questions[0].id;
        const put = (answers: unknown) => api().put(`/checkups/${checkup.id}/answers`).send({ answers });
        expect((await put([answer(q1, 'a'), answer(q1, 'b')])).status).toBe(400);
        expect((await put([answer(q1, '  ')])).status).toBe(400);
        expect((await put([])).status).toBe(400);
        expect((await put([answer(999999)])).status).toBe(400);
        expect(await prisma.question.count({ where: { answer: { not: null } } })).toBe(0);
    });

    it('locks a completed check-up (409) and 404s for a missing one', async () => {
        const { checkup } = await setup();
        const all = checkup.questions.map((q: { id: number }) => answer(q.id));
        await api().put(`/checkups/${checkup.id}/answers`).send({ answers: all }).expect(200);

        const again = await api().put(`/checkups/${checkup.id}/answers`).send({ answers: [answer(all[0].questionId, 'changed')] });
        expect(again.status).toBe(409);
        expect((await prisma.question.findUniqueOrThrow({ where: { id: all[0].questionId } })).answer).toBe('fine');
        expect((await api().put('/checkups/999/answers').send({ answers: [answer(1)] })).status).toBe(404);
    });
});
