import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { llm } from '../../llm/client.js';
import { HttpError } from '../../middleware/errors.js';
import { requireUser } from '../users/service.js';
import { getSummary } from '../vitals/service.js';
import { VITALS, VITAL_TYPES } from '../vitals/types.js';
import {
    buildClosingMessages,
    buildMessages,
    fallbackQuestion,
    parseAssistantReply,
    parseClosingTips,
    type PromptContext,
} from './prompt.js';
import { EMERGENCY_MESSAGE, composeClosingNote, detectEmergency, filterTips } from './safety.js';
import type { UserThreadsQuery } from './schemas.js';

const LLM_ATTEMPTS = 2; // a second try only happens when the reply could not be parsed

// Opening questions are generated after the HTTP response is sent (local models can be
// slow). Tracking them lets shutdown and tests wait for in-flight work.
const background = new Set<Promise<unknown>>();
export function runInBackground(work: Promise<unknown>): void {
    const tracked = work.catch((err) => console.error('[assistant] background task failed:', err)).finally(() => {
        background.delete(tracked);
    });
    background.add(tracked);
}
export async function waitForBackgroundWork(): Promise<void> {
    while (background.size > 0) await Promise.all([...background]);
}

const byId = { orderBy: { id: 'asc' } } as const;
const threadWithMessages = {
    messages: { select: { id: true, role: true, content: true, createdAt: true }, ...byId },
    symptom: { select: { id: true, userId: true, name: true, intensity: true } },
} as const;

// ---------------------------------------------------------------- prompt context

async function buildPromptContext(threadId: number): Promise<{ ctx: PromptContext; assistantCount: number }> {
    const thread = await prisma.followupThread.findUniqueOrThrow({
        where: { id: threadId },
        include: { messages: byId, symptom: { include: { user: true } } },
    });
    const { symptom } = thread;

    // Earlier threads on the same symptom, so a new thread asks what changed instead of repeating.
    const earlier = await prisma.followupThread.findMany({
        where: { symptomId: symptom.id, id: { not: threadId } },
        orderBy: { id: 'desc' },
        take: 2,
        include: { messages: byId },
    });

    const summary = await getSummary(symptom.userId, { from: new Date(Date.now() - 24 * 3600_000) });
    const vitalsSummary = VITAL_TYPES.flatMap((type) => {
        const s = summary[type];
        if (s.count === 0 || s.avg === null) return [];
        const label = { hr: 'Heart rate', bt: 'Body temperature', bo: 'Blood oxygen' }[type];
        const round = (n: number | null) => (n === null ? '?' : Math.round(n * 10) / 10);
        return [`${label}: avg ${round(s.avg)} ${VITALS[type].unit} (range ${round(s.min)}-${round(s.max)}, ${s.count} readings)`];
    });

    return {
        assistantCount: thread.messages.filter((m) => m.role === 'assistant').length,
        ctx: {
            symptom,
            patient: symptom.user,
            vitalsSummary,
            earlierThreads: earlier.reverse().map((t) => ({ messages: t.messages })),
            transcript: thread.messages,
        },
    };
}

// ---------------------------------------------------------------- the model turn

interface Turn {
    question: string | null;
    done: boolean;
}

/**
 * Asks the model for the next turn. Never throws for model problems: if the model is
 * unreachable, times out, or keeps returning unusable output, a generic fallback question
 * is used so the thread can still progress (the failure is logged).
 * `requireQuestion` is for the opening turn, which must produce a question.
 */
async function generateTurn(threadId: number, requireQuestion: boolean): Promise<Turn> {
    const { ctx, assistantCount } = await buildPromptContext(threadId);
    const messages = buildMessages(ctx);

    for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
        let raw: string;
        try {
            raw = await llm.chat(messages);
        } catch (err) {
            console.warn(`[assistant] model call failed, using fallback question: ${err instanceof Error ? err.message : err}`);
            break;
        }
        const reply = parseAssistantReply(raw);
        if (reply && !(requireQuestion && !reply.question)) return reply;
        console.warn(`[assistant] unusable model reply (attempt ${attempt}/${LLM_ATTEMPTS}): ${raw.slice(0, 120)}`);
    }
    return { question: fallbackQuestion(assistantCount), done: false };
}

/**
 * The last message of a thread, with a few very general self-care tips written by the model.
 * Never throws for model problems: without usable tips the thread still ends with a plain
 * closing line. Whatever the model writes is filtered, and the framing is fixed text (safety.ts).
 */
async function generateClosingNote(threadId: number): Promise<string> {
    const { ctx } = await buildPromptContext(threadId);
    const messages = buildClosingMessages(ctx);

    for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
        let raw: string;
        try {
            raw = await llm.chat(messages);
        } catch (err) {
            console.warn(`[assistant] closing tips failed, closing without them: ${err instanceof Error ? err.message : err}`);
            break;
        }
        const tips = parseClosingTips(raw);
        if (!tips) {
            console.warn(`[assistant] unusable closing reply (attempt ${attempt}/${LLM_ATTEMPTS}): ${raw.slice(0, 120)}`);
            continue;
        }
        const { kept, dropped } = filterTips(tips);
        if (dropped.length) console.warn(`[assistant] dropped ${dropped.length} closing tip(s): ${JSON.stringify(dropped).slice(0, 300)}`);
        return composeClosingNote(kept);
    }
    return composeClosingNote([]);
}

// ---------------------------------------------------------------- threads

/** Creates the (empty) thread row. The opening question is added by addOpeningQuestion(). */
export function createThreadRow(symptomId: number) {
    return prisma.followupThread.create({ data: { symptomId } });
}

/**
 * Stores the assistant's last message and closes the thread, in one transaction so a client
 * polling the thread never sees the final message on a thread that still looks open.
 */
async function finishThread(threadId: number, content: string): Promise<void> {
    await prisma.$transaction([
        prisma.followupMessage.create({ data: { threadId, role: 'assistant', content } }),
        prisma.followupThread.update({ where: { id: threadId }, data: { status: 'done', closedAt: new Date() } }),
    ]);
}

export async function addOpeningQuestion(threadId: number): Promise<void> {
    const { symptom } = await prisma.followupThread.findUniqueOrThrow({
        where: { id: threadId },
        select: { symptom: { select: { name: true, notes: true } } },
    });
    // Checked in code, before the model is asked anything
    if (detectEmergency(symptom.name, symptom.notes)) return finishThread(threadId, EMERGENCY_MESSAGE);

    const turn = await generateTurn(threadId, true);
    if (turn.done) return finishThread(threadId, turn.question!); // the model opened with an emergency notice
    await prisma.followupMessage.create({ data: { threadId, role: 'assistant', content: turn.question! } });
}

/** Called when a symptom is logged: opens the first thread without making the caller wait for the model. */
export async function startThreadInBackground(symptomId: number): Promise<number | null> {
    try {
        const thread = await createThreadRow(symptomId);
        runInBackground(addOpeningQuestion(thread.id));
        return thread.id;
    } catch (err) {
        console.error('[assistant] could not open a follow-up thread:', err);
        return null;
    }
}

/** POST /symptoms/:id/threads: open a new thread and wait for its first question. */
export async function openThread(symptomId: number) {
    await prisma.symptom.findUniqueOrThrow({ where: { id: symptomId } });
    const open = await prisma.followupThread.findFirst({ where: { symptomId, status: 'open' } });
    if (open) throw new HttpError(409, `Symptom ${symptomId} already has an open follow-up thread`, { threadId: open.id });

    const thread = await createThreadRow(symptomId);
    await addOpeningQuestion(thread.id);
    return getThread(thread.id);
}

export function listThreads(symptomId: number) {
    return prisma.symptom
        .findUniqueOrThrow({ where: { id: symptomId } })
        .then(() =>
            prisma.followupThread.findMany({
                where: { symptomId },
                orderBy: { id: 'asc' },
                include: { _count: { select: { messages: true } } },
            }),
        )
        .then((rows) => rows.map(({ _count, ...t }) => ({ ...t, messageCount: _count.messages })));
}

export function getThread(id: number) {
    return prisma.followupThread.findUniqueOrThrow({ where: { id }, include: threadWithMessages });
}

// For the medic view: every thread across a patient's symptoms (summaries, no messages).
export async function listUserThreads(userId: number, { from, to, limit, offset }: UserThreadsQuery) {
    await requireUser(userId);
    const rows = await prisma.followupThread.findMany({
        where: { symptom: { userId }, createdAt: { gte: from, lte: to } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
        include: {
            symptom: { select: { id: true, name: true, intensity: true, loggedAt: true } },
            _count: { select: { messages: true } },
        },
    });
    return rows.map(({ _count, ...t }) => ({ ...t, messageCount: _count.messages }));
}

// ---------------------------------------------------------------- answering

export interface AnswerResult {
    // The next question. With done=true it is the closing message (self-care tips, or an
    // urgent-care notice) that expects no answer.
    nextQuestion: string | null;
    done: boolean;
}

/**
 * Stores the patient's answer and produces the next turn. Two phases so the (slow) model
 * call is never inside a database transaction:
 *   1. lock the thread, check it is waiting for this answer, store the answer;
 *   2. ask the model, then store its question or close the thread.
 * Between the phases the last message is the patient's, so a concurrent answer to the same
 * thread is refused with 409 rather than being answered twice.
 */
export async function submitAnswer(threadId: number, answer: string): Promise<AnswerResult> {
    const { assistantCount } = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: number }[]>`SELECT "id" FROM "followup_threads" WHERE "id" = ${threadId} FOR UPDATE`;
        if (locked.length === 0) throw new HttpError(404, 'Record not found');

        const thread = await tx.followupThread.findUniqueOrThrow({ where: { id: threadId }, include: { messages: byId } });
        if (thread.status === 'done') throw new HttpError(409, 'This follow-up thread is closed');
        const last = thread.messages.at(-1);
        if (!last) throw new HttpError(409, 'The assistant has not asked a question yet; try again shortly');
        if (last.role !== 'assistant') throw new HttpError(409, 'The previous answer is still being processed');

        await tx.followupMessage.create({ data: { threadId, role: 'patient', content: answer } });
        return { assistantCount: thread.messages.filter((m) => m.role === 'assistant').length };
    });

    // An emergency is recognised in code, so it never depends on what the model makes of it
    if (detectEmergency(answer)) {
        await finishThread(threadId, EMERGENCY_MESSAGE);
        return { nextQuestion: EMERGENCY_MESSAGE, done: true };
    }

    const endWithClosingNote = async (): Promise<AnswerResult> => {
        const note = await generateClosingNote(threadId);
        await finishThread(threadId, note);
        return { nextQuestion: note, done: true };
    };

    if (assistantCount >= config.ASSISTANT_MAX_QUESTIONS) return endWithClosingNote();

    const turn = await generateTurn(threadId, false);
    if (turn.done && !turn.question) return endWithClosingNote(); // the model has what it needs
    if (turn.done) await finishThread(threadId, turn.question!); // done with a message is the model's own urgent notice
    else await prisma.followupMessage.create({ data: { threadId, role: 'assistant', content: turn.question! } });
    return { nextQuestion: turn.question, done: turn.done };
}
