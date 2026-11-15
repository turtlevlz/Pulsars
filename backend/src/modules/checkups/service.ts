import { prisma } from '../../db.js';
import { HttpError } from '../../middleware/errors.js';
import { requireUser } from '../users/service.js';
import type { CreateCheckupBody, ListCheckupsQuery, SubmitAnswersBody } from './schemas.js';

const people = { select: { id: true, name: true } } as const;

const detail = {
    patient: people,
    medic: people,
    questions: { select: { id: true, question: true, answer: true }, orderBy: { id: 'asc' } },
} as const;

// A medic assigns a check-up to a patient. The check-up and its questions are created in one
// transaction. The response is read after it commits: a read that includes several relations
// loads them concurrently, and inside an interactive transaction (a single connection) that
// makes node-postgres emit a deprecation warning.
export async function createCheckup({ questions, ...input }: CreateCheckupBody) {
    await requireUser(input.userId, 'patient');
    await requireUser(input.medicId, 'medic');
    const id = await prisma.$transaction(async (tx) => {
        const { id } = await tx.checkup.create({ data: input });
        await tx.question.createMany({ data: questions.map((question) => ({ checkupId: id, question })) });
        return id;
    });
    return getCheckup(id);
}

// For a patient: check-ups assigned to them. For a medic: check-ups they assigned.
export async function listCheckups(userId: number, { status, limit, offset }: ListCheckupsQuery) {
    const user = await requireUser(userId);
    const rows = await prisma.checkup.findMany({
        where: { ...(user.role === 'medic' ? { medicId: userId } : { userId }), status },
        orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
        include: { patient: people, medic: people, questions: { select: { answer: true } } },
    });
    return rows.map(({ questions, ...checkup }) => ({
        ...checkup,
        questionCount: questions.length,
        answeredCount: questions.filter((q) => q.answer !== null).length,
    }));
}

export function getCheckup(id: number) {
    return prisma.checkup.findUniqueOrThrow({ where: { id }, include: detail });
}

// Saves answers (partial submissions are fine). When every question has an answer the
// check-up becomes `completed`. Validation happens before any write, so a bad request
// changes nothing.
export async function submitAnswers(id: number, { answers }: SubmitAnswersBody) {
    await prisma.$transaction(async (tx) => {
        const checkup = await tx.checkup.findUniqueOrThrow({
            where: { id },
            include: { questions: { select: { id: true, answer: true } } },
        });
        if (checkup.status === 'completed') throw new HttpError(409, 'Check-up is already completed');

        const own = new Set(checkup.questions.map((q) => q.id));
        const foreign = answers.filter((a) => !own.has(a.questionId)).map((a) => a.questionId);
        if (foreign.length > 0) {
            throw new HttpError(400, `Questions do not belong to check-up ${id}`, { questionIds: foreign });
        }

        for (const { questionId, answer } of answers) {
            await tx.question.update({ where: { id: questionId }, data: { answer } });
        }

        const unanswered = await tx.question.count({ where: { checkupId: id, answer: null } });
        if (unanswered === 0) {
            await tx.checkup.update({ where: { id }, data: { status: 'completed', completedAt: new Date() } });
        }
    });
    return getCheckup(id); // after commit, see createCheckup
}
