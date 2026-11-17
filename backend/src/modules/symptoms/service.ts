import { prisma } from '../../db.js';
import { startThreadInBackground } from '../assistant/service.js';
import { requireUser } from '../users/service.js';
import type { CreateSymptomBody, ListSymptomsQuery, UpdateSymptomBody } from './schemas.js';

// Logging a symptom also opens its first follow-up thread. The assistant's opening question
// is generated in the background (local models can be slow), so `threadId` is returned
// straight away and the dashboard polls GET /threads/:id until the question appears.
export async function createSymptom(userId: number, input: CreateSymptomBody) {
    await requireUser(userId, 'patient');
    const symptom = await prisma.symptom.create({ data: { ...input, userId } });
    const threadId = await startThreadInBackground(symptom.id);
    return { ...symptom, threadId };
}

export async function listSymptoms(userId: number, { from, to, limit, offset }: ListSymptomsQuery) {
    await requireUser(userId);
    return prisma.symptom.findMany({
        where: { userId, loggedAt: { gte: from, lte: to } },
        orderBy: [{ loggedAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
    });
}

// Includes the symptom's follow-up threads (summaries only; messages come from GET /threads/:id).
export function getSymptom(id: number) {
    return prisma.symptom.findUniqueOrThrow({
        where: { id },
        include: {
            threads: {
                select: { id: true, status: true, createdAt: true, closedAt: true },
                orderBy: { createdAt: 'asc' },
            },
        },
    });
}

export function updateSymptom(id: number, input: UpdateSymptomBody) {
    return prisma.symptom.update({ where: { id }, data: input });
}

export async function deleteSymptom(id: number) {
    await prisma.symptom.delete({ where: { id } }); // follow-up threads/messages cascade
}
