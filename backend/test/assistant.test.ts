import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { LlmError, setLlmClient } from '../src/llm/client.js';
import { CLOSING_PROMPT, FALLBACK_QUESTIONS } from '../src/modules/assistant/prompt.js';
import { MAX_ASSISTANT_QUESTIONS } from '../src/modules/assistant/service.js';
import { EMERGENCY_MESSAGE } from '../src/modules/assistant/safety.js';
import { api, assignCheckup, makeMedic, makePatient, makeSymptom, reply, scriptedLlm } from './helpers.js';

type As = { token: string };
const answer = (as: As, threadId: number, text = 'an answer') => api(as).post(`/threads/${threadId}/messages`).send({ answer: text });
const openThread = (as: As, symptomId: number) => api(as).post(`/symptoms/${symptomId}/threads`);
const routineReply = (...steps: string[]) => JSON.stringify({ routine: steps });
const messagesOf = (threadId: number) => prisma.followupMessage.findMany({ where: { threadId }, orderBy: { id: 'asc' } });
const thread = (id: number) => prisma.followupThread.findUniqueOrThrow({ where: { id } });

async function started(script: (string | Error)[]) {
    const llm = scriptedLlm(script);
    setLlmClient(llm.client);
    const patient = await makePatient();
    const symptom = await makeSymptom(patient.id);
    const res = await openThread(patient, symptom.id);
    return { ...llm, patient, symptom, threadId: res.body.id as number, res };
}

describe('POST /symptoms/:id/threads', () => {
    it("opens a thread with the model's first question", async () => {
        const { patient, res, symptom } = await started([reply('When did it start?')]);
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ status: 'open', closedAt: null, symptom: { id: symptom.id, name: 'Headache' } });
        expect(res.body.messages).toEqual([expect.objectContaining({ role: 'assistant', content: 'When did it start?' })]);
    });

    it('gives the model the symptom, the patient profile and the last 24 hours of vitals', async () => {
        const llm = scriptedLlm([reply('Q?')]);
        setLlmClient(llm.client);
        const patient = await makePatient({ age: 41, weight: 80, height: 175 });
        const symptom = await makeSymptom(patient.id, { name: 'Dizziness', intensity: 4, notes: 'when standing up' });
        await prisma.heartRate.create({ data: { userId: patient.id, heartRate: 88, recordedAt: new Date() } });
        await prisma.heartRate.create({ data: { userId: patient.id, heartRate: 200, recordedAt: new Date(Date.now() - 3 * 24 * 3600_000) } }); // too old

        await openThread(patient, symptom.id).expect(201);
        const [system, context] = llm.calls[0];
        expect(system.role).toBe('system');
        expect(context.content).toContain('Name: Dizziness');
        expect(context.content).toContain('Intensity: 4 out of 5');
        expect(context.content).toContain('"when standing up"');
        expect(context.content).toContain('age 41, weight 80 kg, height 175 cm');
        expect(context.content).toContain('Heart rate: avg 88 bpm');
        expect(context.content).not.toContain('200');
    });

    it('describes the wearable\'s readings as what they are: skin temperature and experimental SpO2', async () => {
        const llm = scriptedLlm([reply('Q?')]);
        setLlmClient(llm.client);
        const patient = await makePatient();
        const symptom = await makeSymptom(patient.id);
        const at = new Date();
        await prisma.bodyTemp.create({ data: { userId: patient.id, bodyTemp: 33.6, recordedAt: at } });
        await prisma.bloodOxygen.create({ data: { userId: patient.id, bloodO: 97, recordedAt: at } });

        await openThread(patient, symptom.id).expect(201);
        const context = llm.calls[0][1].content;
        expect(context).toContain('Skin temperature (forearm sensor, not core body temperature): avg 33.6');
        expect(context).toContain('Blood oxygen (experimental fingertip sensor): avg 97');
        expect(context).not.toContain('Body temperature');
    });

    it('uses a fallback question if the model is unreachable', async () => {
        const { patient, res } = await started([new LlmError('connection refused')]);
        expect(res.status).toBe(201);
        expect(res.body.messages[0].content).toBe(FALLBACK_QUESTIONS[0]);
    });

    it('retries once when the reply is unusable, and needs an actual question to open', async () => {
        const { patient, res, calls } = await started([reply(null, true), reply('Real question?')]);
        expect(res.body.messages[0].content).toBe('Real question?');
        expect(calls).toHaveLength(2);
    });

    it('404s for an unknown symptom', async () => {
        expect((await openThread(await makePatient(), 999)).status).toBe(404);
    });

    it('refuses a second thread while one is open, then allows one once it is closed', async () => {
        const { patient, symptom, threadId } = await started([reply('First thread Q?')]);
        const dup = await openThread(patient, symptom.id);
        expect(dup.status).toBe(409);
        expect(dup.body.details).toEqual({ threadId });

        await prisma.followupThread.update({ where: { id: threadId }, data: { status: 'done', closedAt: new Date() } });
        const llm = scriptedLlm([reply('Has it changed since last time?')]);
        setLlmClient(llm.client);
        const second = await openThread(patient, symptom.id);
        expect(second.status).toBe(201);
        expect(second.body.id).not.toBe(threadId);
    });

    it('tells the model about earlier threads so it can ask what changed', async () => {
        const { patient, symptom, threadId } = await started([reply('When did it start?'), reply('Anything else?', false)]);
        await answer(patient, threadId, 'Since Monday').expect(200);
        await prisma.followupThread.update({ where: { id: threadId }, data: { status: 'done', closedAt: new Date() } });

        const llm = scriptedLlm([reply('Is it better or worse than before?')]);
        setLlmClient(llm.client);
        await openThread(patient, symptom.id).expect(201);
        const context = llm.calls[0][1].content;
        expect(context).toContain('Earlier follow-up threads');
        expect(context).toContain('Q: When did it start?');
        expect(context).toContain('A: Since Monday');
    });
});

describe('POST /threads/:id/messages', () => {
    it('stores the answer and returns the next question, replaying the conversation to the model', async () => {
        const { patient, threadId, calls } = await started([reply('When did it start?'), reply('Does anything help?')]);
        const res = await answer(patient, threadId, '  Since Monday  ');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ nextQuestion: 'Does anything help?', done: false });

        const msgs = await messagesOf(threadId);
        expect(msgs.map((m) => [m.role, m.content])).toEqual([
            ['assistant', 'When did it start?'],
            ['patient', 'Since Monday'],
            ['assistant', 'Does anything help?'],
        ]);
        const sent = calls[1];
        expect(sent.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
        expect(JSON.parse(sent[2].content)).toEqual({ question: 'When did it start?', done: false });
        expect(sent[3].content).toBe('Since Monday');
    });

    it('keeps asking past four questions while the model has more to ask, then closes with a routine', async () => {
        const { patient, threadId, calls } = await started([
            reply('Q1?'), reply('Q2?'), reply('Q3?'), reply('Q4?'), reply('Q5?'), reply('Q6?'), reply(null, true),
            routineReply('rest in a quiet room', 'Drink some water.', 'Write down when it happens.'),
        ]);
        for (const [i, next] of ['Q2?', 'Q3?', 'Q4?', 'Q5?', 'Q6?'].entries()) {
            expect((await answer(patient, threadId, `a${i + 1}`)).body).toEqual({ nextQuestion: next, done: false });
        }

        const last = await answer(patient, threadId, 'a6');
        expect(last.body.done).toBe(true);
        expect(last.body.nextQuestion).toContain('1. Rest in a quiet room.\n2. Drink some water.\n3. Write down when it happens.');
        expect(last.body.nextQuestion).toMatch(/routine/i);
        expect(last.body.nextQuestion).toMatch(/not medical advice/i);
        expect(last.body.nextQuestion).toMatch(/contact your medic/i);

        expect(calls).toHaveLength(8); // opening + six follow-ups (the last one says done) + the closing routine
        const closing = calls[7];
        expect(closing[0]).toEqual({ role: 'system', content: CLOSING_PROMPT });
        expect(closing[1].content).toContain('Name: Headache');
        for (const line of ['Q: Q1?', 'A: a1', 'Q: Q6?', 'A: a6']) expect(closing[1].content).toContain(line);

        const t = await thread(threadId);
        expect(t.status).toBe('done');
        expect(t.closedAt).not.toBeNull();
        const msgs = await messagesOf(threadId);
        expect(msgs.map((m) => m.role)).toEqual([
            'assistant', 'patient', 'assistant', 'patient', 'assistant', 'patient',
            'assistant', 'patient', 'assistant', 'patient', 'assistant', 'patient', 'assistant',
        ]);
        expect(msgs.at(-1)!.content).toBe(last.body.nextQuestion);
        expect((await answer(patient, threadId, 'too late')).status).toBe(409);
        expect(await prisma.followupMessage.count({ where: { threadId } })).toBe(13);
    });

    it('finishes with a routine when the model starts repeating itself, instead of asking the same thing again', async () => {
        const { patient, threadId, calls } = await started([
            reply('Okay. When did it start?'), reply('Does anything make it better?'),
            reply('Thanks. When did it start?'), // the same question again
            routineReply('Rest for a while.'),
        ]);
        expect((await answer(patient, threadId, 'a1')).body).toEqual({ nextQuestion: 'Does anything make it better?', done: false });

        const res = await answer(patient, threadId, 'a2');
        expect(res.body.done).toBe(true);
        expect(res.body.nextQuestion).toContain('1. Rest for a while.');
        expect(calls).toHaveLength(4); // opening, one follow-up, the repeat, the closing routine
        expect((await thread(threadId)).status).toBe('done');
        // the repeated question was never shown to the patient
        expect((await messagesOf(threadId)).map((m) => m.content)).not.toContain('Thanks. When did it start?');
    });

    it('ends a thread whose model never says it is done, at the backstop', async () => {
        const questions = Array.from({ length: MAX_ASSISTANT_QUESTIONS }, (_, i) => reply(`Q${i + 1}?`));
        const { patient, threadId, calls } = await started([...questions, routineReply('Rest for a while.')]);
        for (let i = 1; i < MAX_ASSISTANT_QUESTIONS; i++) {
            expect((await answer(patient, threadId, `a${i}`)).body.done).toBe(false);
        }
        const last = await answer(patient, threadId, 'last answer');
        expect(last.body.done).toBe(true);
        expect(last.body.nextQuestion).toContain('1. Rest for a while.');
        expect(calls).toHaveLength(MAX_ASSISTANT_QUESTIONS + 1);
        expect((await thread(threadId)).status).toBe('done');
    });

    it('ends the thread instead of repeating generic questions when the model stays down', async () => {
        const down = new LlmError('connection refused');
        const { patient, threadId } = await started([down, down, down, down, down, down]);
        const asked = [FALLBACK_QUESTIONS[0]];
        for (const expected of FALLBACK_QUESTIONS.slice(1)) {
            const res = await answer(patient, threadId, 'an answer');
            expect(res.body).toEqual({ nextQuestion: expected, done: false });
            asked.push(res.body.nextQuestion);
        }
        expect(asked).toEqual(FALLBACK_QUESTIONS);

        const res = await answer(patient, threadId, 'an answer');
        expect(res.body.done).toBe(true);
        expect(res.body.nextQuestion).toMatch(/care team will review/i); // the plain closing line
        expect((await thread(threadId)).status).toBe('done');
    });

    it('closes with the plain line, not an invented routine, if the closing call fails or stays unreadable', async () => {
        for (const script of [[new LlmError('down')], ['not json', 'still not json']]) {
            const { patient, threadId } = await started([reply('Q1?'), reply(null, true), ...script]);
            const res = await answer(patient, threadId, 'a1');
            expect(res.body.done).toBe(true);
            expect(res.body.nextQuestion).toMatch(/care team will review/i);
            expect(res.body.nextQuestion).toMatch(/contact your medic/i);
            expect(res.body.nextQuestion).not.toMatch(/^\d+\. /m);
            expect((await thread(threadId)).status).toBe('done');
        }
    });

    it('drops routine steps about medicine or causes and keeps the rest', async () => {
        const { patient, threadId } = await started([
            reply('Q1?'), reply(null, true),
            routineReply('Take 400 mg of ibuprofen.', 'Rest in a dark room.', 'This is probably caused by stress.'),
        ]);
        const { nextQuestion } = (await answer(patient, threadId, 'a1')).body;
        expect(nextQuestion).toContain('1. Rest in a dark room.');
        expect(nextQuestion).not.toMatch(/ibuprofen|stress/i);
    });

    it('uses the plain closing line when every step is dropped', async () => {
        const { patient, threadId } = await started([reply('Q1?'), reply(null, true), routineReply('Take paracetamol.')]);
        const { nextQuestion } = (await answer(patient, threadId, 'a1')).body;
        expect(nextQuestion).toMatch(/care team will review/i);
        expect(nextQuestion).not.toContain('paracetamol');
    });

    it('retries an unreadable closing reply once', async () => {
        const { patient, threadId, calls } = await started([reply('Q1?'), reply(null, true), 'oops', routineReply('Drink some water.')]);
        expect((await answer(patient, threadId, 'a1')).body.nextQuestion).toContain('1. Drink some water.');
        expect(calls).toHaveLength(4);
    });

    it('closes early with a closing note when the model says it has enough information', async () => {
        const { patient, threadId } = await started([reply('Q1?'), reply(null, true), routineReply('Rest for a while.')]);
        const res = await answer(patient, threadId);
        expect(res.body.done).toBe(true);
        expect(res.body.nextQuestion).toContain('1. Rest for a while.');
        expect((await thread(threadId)).status).toBe('done');
        const msgs = await messagesOf(threadId);
        expect(msgs).toHaveLength(3);
        expect(msgs.at(-1)).toMatchObject({ role: 'assistant', content: res.body.nextQuestion });
    });

    it("delivers the model's own emergency notice as a final message and closes the thread, with no tips", async () => {
        const notice = 'This could be serious. Please contact your medic right away.';
        const { patient, threadId } = await started([reply('Q1?'), reply(notice, true)]);
        const res = await answer(patient, threadId, 'It is getting much worse and I feel awful');
        expect(res.body).toEqual({ nextQuestion: notice, done: true });
        const msgs = await messagesOf(threadId);
        expect(msgs.at(-1)).toMatchObject({ role: 'assistant', content: notice });
        expect((await thread(threadId)).status).toBe('done');
    });

    describe('emergencies recognised in code', () => {
        it('tells a patient to contact their medic as soon as an answer describes one, without asking the model', async () => {
            const { patient, threadId, calls } = await started([reply('Anything else?')]);
            const res = await answer(patient, threadId, 'Now my chest hurts and I cannot breathe');
            expect(res.body).toEqual({ nextQuestion: EMERGENCY_MESSAGE, done: true });
            expect(calls).toHaveLength(1); // only the opening question was generated
            expect((await messagesOf(threadId)).at(-1)).toMatchObject({ role: 'assistant', content: EMERGENCY_MESSAGE });
            expect((await thread(threadId)).status).toBe('done');
        });

        it('gives the urgent message, not self-care tips, when the last answer is the alarming one', async () => {
            const { patient, threadId, calls } = await started([reply('Q1?'), reply('Q2?'), reply('Q3?'), reply('Q4?')]);
            for (const a of ['a1', 'a2', 'a3']) await answer(patient, threadId, a).expect(200);
            const res = await answer(patient, threadId, 'I passed out for a moment');
            expect(res.body).toEqual({ nextQuestion: EMERGENCY_MESSAGE, done: true });
            expect(calls).toHaveLength(4); // no closing-tips request
        });

        it('does not mistake a denial for an emergency', async () => {
            const { patient, threadId } = await started([reply('Q1?'), reply('Any other symptoms?')]);
            const res = await answer(patient, threadId, 'No chest pain or trouble breathing, just a bit nauseous');
            expect(res.body).toEqual({ nextQuestion: 'Any other symptoms?', done: false });
            expect((await thread(threadId)).status).toBe('open');
        });

        it('recognises one in the symptom itself and closes the thread without asking the model', async () => {
            const llm = scriptedLlm([]);
            setLlmClient(llm.client);
            const patient = await makePatient();
            const symptom = await makeSymptom(patient.id, {
                name: 'Chest discomfort',
                notes: 'Crushing pressure and my left arm is going numb',
            });
            const res = await openThread(patient, symptom.id);
            expect(res.status).toBe(201);
            expect(res.body.status).toBe('done');
            expect(res.body.messages).toEqual([expect.objectContaining({ role: 'assistant', content: EMERGENCY_MESSAGE })]);
            expect(llm.calls).toHaveLength(0);
        });

        it('closes the thread when the model itself opens with an emergency notice', async () => {
            const notice = 'This could be serious. Please contact your medic right away.';
            const { patient, res } = await started([reply(notice, true)]);
            expect(res.body.status).toBe('done');
            expect(res.body.messages).toEqual([expect.objectContaining({ content: notice })]);
        });
    });

    it('understands JSON wrapped in a markdown fence', async () => {
        const { patient, threadId } = await started([reply('Q1?'), '```json\n{"question":"Any fever?","done":false}\n```']);
        expect((await answer(patient, threadId)).body).toEqual({ nextQuestion: 'Any fever?', done: false });
    });

    it('falls back to a generic question when the model fails, and the thread carries on', async () => {
        const { patient, threadId, calls } = await started([reply('Q1?'), new LlmError('timed out'), reply('Q3?')]);
        const res = await answer(patient, threadId, 'a1');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ nextQuestion: FALLBACK_QUESTIONS[1], done: false });
        expect(calls).toHaveLength(2); // a network failure is not retried

        expect((await answer(patient, threadId, 'a2')).body).toEqual({ nextQuestion: 'Q3?', done: false });
    });

    it('retries once on an unusable reply, then falls back', async () => {
        const { patient, threadId, calls } = await started([reply('Q1?'), 'I am not JSON', 'still not JSON']);
        expect((await answer(patient, threadId)).body.nextQuestion).toBe(FALLBACK_QUESTIONS[1]);
        expect(calls).toHaveLength(3);
    });

    it('uses the retry when the second reply is good', async () => {
        const { patient, threadId, calls } = await started([reply('Q1?'), 'oops', reply('Better Q?')]);
        expect((await answer(patient, threadId)).body.nextQuestion).toBe('Better Q?');
        expect(calls).toHaveLength(3);
    });

    it('refuses an answer to a closed thread', async () => {
        const { patient, threadId } = await started([reply('Q1?')]);
        await prisma.followupThread.update({ where: { id: threadId }, data: { status: 'done' } });
        const res = await answer(patient, threadId);
        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/closed/);
        expect(await prisma.followupMessage.count({ where: { threadId, role: 'patient' } })).toBe(0);
    });

    it('refuses an answer before the assistant has asked anything', async () => {
        const patient = await makePatient();
        const s = await makeSymptom(patient.id);
        const t = await prisma.followupThread.create({ data: { symptomId: s.id } });
        const res = await answer(patient, t.id);
        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/not asked/);
        expect(await messagesOf(t.id)).toHaveLength(0);
    });

    it('refuses a second answer while the first is still being processed', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        let modelCalled!: () => void;
        const entered = new Promise<void>((r) => (modelCalled = r));
        let n = 0;
        setLlmClient({
            chat: async () => {
                if (++n === 1) return reply('Q1?');
                modelCalled();
                await gate;
                return reply('Q2?');
            },
        });
        const patient = await makePatient();
        const s = await makeSymptom(patient.id);
        const { body } = await openThread(patient, s.id).expect(201);

        const first = answer(patient, body.id, 'one').then((r) => r);
        await entered; // first answer is stored and waiting on the model
        const second = await answer(patient, body.id, 'two');
        expect(second.status).toBe(409);
        expect(second.body.error).toMatch(/still being processed/);

        release();
        const firstRes = await first;
        expect(firstRes.status).toBe(200);
        expect(firstRes.body.nextQuestion).toBe('Q2?');
        expect(await prisma.followupMessage.count({ where: { threadId: body.id, role: 'patient' } })).toBe(1);
    });

    it('validates the request and 404s for an unknown thread', async () => {
        const { patient, threadId } = await started([reply('Q1?')]);
        expect((await api(patient).post(`/threads/${threadId}/messages`).send({ answer: '   ' })).status).toBe(400);
        expect((await api(patient).post(`/threads/${threadId}/messages`).send({})).status).toBe(400);
        expect((await api(patient).post(`/threads/${threadId}/messages`).send({ answer: 'x'.repeat(2001) })).status).toBe(400);
        expect((await api(patient).post(`/threads/${threadId}/messages`).send({ answer: 'ok', role: 'assistant' })).status).toBe(400);
        expect((await api(patient).post('/threads/999/messages').send({ answer: 'x' })).status).toBe(404);
        expect(await prisma.followupMessage.count({ where: { threadId, role: 'patient' } })).toBe(0);
    });
});

describe('reading threads', () => {
    it('GET /threads/:id returns the thread with its messages in order', async () => {
        const { patient, threadId } = await started([reply('Q1?'), reply('Q2?')]);
        await answer(patient, threadId, 'a1');
        const res = await api(patient).get(`/threads/${threadId}`);
        expect(res.status).toBe(200);
        expect(res.body.messages.map((m: { role: string }) => m.role)).toEqual(['assistant', 'patient', 'assistant']);
        expect((await api(patient).get('/threads/999')).status).toBe(404);
    });

    it("GET /symptoms/:id/threads lists a symptom's threads, and the symptom detail shows them too", async () => {
        const { patient, symptom, threadId } = await started([reply('Q1?')]);
        await prisma.followupThread.update({ where: { id: threadId }, data: { status: 'done' } });
        setLlmClient(scriptedLlm([reply('Q again?')]).client);
        const second = await openThread(patient, symptom.id).expect(201);

        const list = await api(patient).get(`/symptoms/${symptom.id}/threads`);
        expect(list.body.map((t: { id: number }) => t.id)).toEqual([threadId, second.body.id]);
        expect(list.body.map((t: { status: string }) => t.status)).toEqual(['done', 'open']);
        expect(list.body.map((t: { messageCount: number }) => t.messageCount)).toEqual([1, 1]);

        const detail = await api(patient).get(`/symptoms/${symptom.id}`);
        expect(detail.body.threads).toHaveLength(2);
        expect((await api(patient).get('/symptoms/999/threads')).status).toBe(404);
    });

    it("GET /users/:id/threads gives the medic view of all a patient's threads, newest first", async () => {
        const medic = await makeMedic();
        const patient = await makePatient();
        const other = await makePatient();
        await assignCheckup(medic.id, patient.id);
        const a = await makeSymptom(patient.id, { name: 'Headache' });
        const b = await makeSymptom(patient.id, { name: 'Cough' });
        const c = await makeSymptom(other.id, { name: 'Not mine' });
        const t1 = await prisma.followupThread.create({ data: { symptomId: a.id, createdAt: new Date('2026-11-10T00:00:00Z') } });
        const t2 = await prisma.followupThread.create({ data: { symptomId: b.id, createdAt: new Date('2026-11-12T00:00:00Z') } });
        await prisma.followupThread.create({ data: { symptomId: c.id } });
        await prisma.followupMessage.create({ data: { threadId: t2.id, role: 'assistant', content: 'q?' } });

        const res = await api(medic).get(`/users/${patient.id}/threads`);
        expect(res.status).toBe(200);
        expect(res.body.map((t: { id: number }) => t.id)).toEqual([t2.id, t1.id]);
        expect(res.body[0]).toMatchObject({ messageCount: 1, symptom: { name: 'Cough' } });
        expect(res.body[0]).not.toHaveProperty('messages');

        // the patient sees the same list
        expect((await api(patient).get(`/users/${patient.id}/threads`)).body).toHaveLength(2);

        const ranged = await api(medic).get(`/users/${patient.id}/threads?from=2026-11-11T00:00:00Z`);
        expect(ranged.body.map((t: { id: number }) => t.id)).toEqual([t2.id]);
        expect((await api(medic).get(`/users/${patient.id}/threads?from=2026-12-01T00:00:00Z&to=2026-11-01T00:00:00Z`)).status).toBe(400);
        expect((await api(medic).get('/users/999/threads')).status).toBe(403);
    });
});
