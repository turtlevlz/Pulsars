import { z } from 'zod';
import type { ChatMessage } from '../../llm/client.js';

export const SYSTEM_PROMPT = `You are a friendly intake assistant inside a health-monitoring app. A patient has logged a symptom. Your job is to have a short, natural conversation that helps their care team understand it: you ask follow-up questions in plain language, one at a time (for example: when it started, where it is and what it feels like, what triggers or relieves it, related symptoms, how it affects daily life).

How to talk:
- You may open with a short sentence that acknowledges what the patient just said, and say briefly why you are asking. Then ask your question. Keep the whole message to a few sentences and ask only ONE question per message.
- Follow where the answers lead: choose the most useful next question from what the patient has told you instead of working through a fixed list.
- You decide when the conversation is finished. Stop as soon as the care team would have a clear picture of the symptom: when the patient says they have nothing more to add, or when the only questions left are ones they have already answered. Do not ask questions just to fill space, and do not stop while an important detail (when it started, how bad it is, what triggers it) is still missing. Most symptoms need only a handful of questions.
- You may mention a vitals reading when it helps you ask a better question, but do not interpret it or say whether it is normal.

Rules:
- Never diagnose, never name likely conditions or causes, never recommend medication or treatment.
- Never repeat a question that was already asked (in this conversation or in earlier threads).
- If the patient describes something that could be an emergency (for example chest pain, trouble breathing, fainting, signs of a stroke, severe bleeding, thoughts of self-harm), put a brief message in "question" telling them to contact their medic right away, and set "done" to true.
- When you have enough information, set "done" to true and "question" to null. A short self-care routine is added for the patient automatically after you finish, so do not write one yourself.

Respond with ONLY a JSON object, nothing else: {"question": string or null, "done": boolean}`;

// The last message of a thread: a short general routine for the patient to follow until the care
// team has reviewed the symptom. Only the steps come from the model. The framing, the "contact
// your medic" line and a filter that drops anything about medicine or causes are applied in code
// (see safety.ts).
export const CLOSING_PROMPT = `You are writing the last message of a symptom chat inside a health-monitoring app. A patient logged a symptom and answered some follow-up questions. Write a short, general routine for them to follow until their care team has reviewed this: 3 to 6 steps, in the order they would do them.

Rules:
- Make it a routine, not a pile of loose tips. Cover what to do now (for example resting, drinking water, regular meals, a quiet or dark room, gentle movement or stretching, easing off an activity that makes it worse), what to keep track of over the next day or so (for example writing down when it happens, how strong it is, what seems to trigger or relieve it, and whether it spreads or changes), and when to log it again in the app or check back in.
- You may include what to watch for that means they should contact their medic sooner (for example it gets worse, spreads, or new symptoms appear). Say "your medic", not "medical help".
- Fit the routine to what the patient actually told you. Leave out anything that does not apply to their answers.
- Never diagnose. Never name a likely condition or cause.
- Never mention medicines, drugs, doses, supplements, herbal remedies, creams, procedures or any other treatment.
- Never say the symptom is harmless or nothing to worry about.
- You may mention a vitals reading when it is relevant, but do not interpret it or say whether it is normal.
- Each step is one or two short, warm, plain-language sentences, written to the patient ("you").

Respond with ONLY a JSON object, nothing else: {"routine": ["...", "..."]}`;

// "tips" is accepted too: a small model asked for a "routine" sometimes answers with the old key.
const routineSchema = z.object({ routine: z.array(z.string()).optional(), tips: z.array(z.string()).optional() });

/** The routine steps from a closing reply, or null if the reply can't be read. Safety filtering happens later. */
export function parseClosingTips(raw: string): string[] | null {
    const text = raw.replace(/```(?:json)?/gi, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;

    let json: unknown;
    try {
        json = JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
    const parsed = routineSchema.safeParse(json);
    return parsed.success ? (parsed.data.routine ?? parsed.data.tips ?? null) : null;
}

// Used when the model is unreachable or keeps returning something unusable, so a thread
// still progresses. Generic on purpose: they make sense for any symptom.
export const FALLBACK_QUESTIONS = [
    'When did this symptom start, and has it changed since then?',
    'Does anything make it better or worse?',
    'Have you noticed any other symptoms along with it?',
    'How is it affecting your daily activities?',
];

export function fallbackQuestion(askedSoFar: number): string {
    return FALLBACK_QUESTIONS[askedSoFar % FALLBACK_QUESTIONS.length];
}

const MAX_QUESTION_LENGTH = 500;

const replySchema = z.object({
    question: z.string().nullish(),
    done: z.boolean().default(false),
});

export interface AssistantReply {
    question: string | null;
    done: boolean;
}

/**
 * Turns raw model output into a usable reply, or null if it can't be trusted. Models
 * often wrap JSON in markdown fences or add chatter around it, so the first {...} block
 * is extracted. A reply that neither asks anything nor finishes is unusable.
 */
export function parseAssistantReply(raw: string): AssistantReply | null {
    const text = raw.replace(/```(?:json)?/gi, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;

    let json: unknown;
    try {
        json = JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
    const parsed = replySchema.safeParse(json);
    if (!parsed.success) return null;

    const question = parsed.data.question?.trim().slice(0, MAX_QUESTION_LENGTH) || null;
    if (!question && !parsed.data.done) return null;
    return { question, done: parsed.data.done };
}

// The question itself, without the sentence of acknowledgement the model may put in front of it.
const askedText = (message: string): string => {
    const sentences = message.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    const last = sentences.at(-1) ?? message;
    return last.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
};

/**
 * True when the model is asking something it already asked in this conversation. The prompt
 * forbids it, but a small model does it anyway when it has nothing left to ask, so a repeat is
 * taken to mean the conversation is over.
 */
export function repeatsEarlierQuestion(question: string, transcript: { role: string; content: string }[]): boolean {
    const asked = askedText(question);
    return asked !== '' && transcript.some((m) => m.role === 'assistant' && askedText(m.content) === asked);
}

export interface PromptContext {
    symptom: {
        name: string;
        intensity: number;
        frequency: string;
        durationMinutes: number | null;
        notes: string | null;
        loggedAt: Date;
    };
    patient: { age: number | null; weight: number | null; height: number | null };
    vitalsSummary: string[]; // one line per vital that has readings; empty if none
    earlierThreads: { messages: { role: 'assistant' | 'patient'; content: string }[] }[];
    transcript: { role: 'assistant' | 'patient'; content: string }[];
}

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n)}...` : s);

export function buildContextText({ symptom, patient, vitalsSummary, earlierThreads }: PromptContext): string {
    const lines = [
        'Symptom logged by the patient:',
        `- Name: ${symptom.name}`,
        `- Intensity: ${symptom.intensity} out of 5`,
        `- Frequency: ${symptom.frequency.replaceAll('_', ' ')}`,
    ];
    if (symptom.durationMinutes !== null) lines.push(`- Duration: ${symptom.durationMinutes} minutes`);
    if (symptom.notes) lines.push(`- Notes: "${clip(symptom.notes, 500)}"`);
    lines.push(`- Logged at: ${symptom.loggedAt.toISOString()}`);

    const profile = [
        patient.age !== null && `age ${patient.age}`,
        patient.weight !== null && `weight ${patient.weight} kg`,
        patient.height !== null && `height ${patient.height} cm`,
    ].filter(Boolean);
    lines.push('', profile.length ? `Patient: ${profile.join(', ')}` : 'Patient: no profile details on file');

    lines.push(
        '',
        vitalsSummary.length
            ? 'Vitals over the last 24 hours (context only):'
            : 'No vitals were recorded in the last 24 hours.',
        ...vitalsSummary.map((l) => `- ${l}`),
    );

    if (earlierThreads.length) {
        lines.push('', 'Earlier follow-up threads about this symptom (do not repeat these questions):');
        earlierThreads.forEach((t, i) => {
            lines.push(`Thread ${i + 1}:`);
            for (const m of t.messages) lines.push(`  ${m.role === 'assistant' ? 'Q' : 'A'}: ${clip(m.content)}`);
        });
    }
    return lines.join('\n');
}

// The conversation so far, in the same JSON shape the model is asked to produce, so its own
// earlier turns look like examples of the format.
export function buildMessages(ctx: PromptContext): ChatMessage[] {
    const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content:
                buildContextText(ctx) +
                (ctx.transcript.length === 0 ? '\n\nAsk the first follow-up question.' : '\n\nThe conversation follows.'),
        },
    ];
    for (const m of ctx.transcript) {
        messages.push(
            m.role === 'assistant'
                ? { role: 'assistant', content: JSON.stringify({ question: m.content, done: false }) }
                : { role: 'user', content: m.content },
        );
    }
    return messages;
}

/** One request for the closing tips: the symptom, then the whole conversation as plain text. */
export function buildClosingMessages(ctx: PromptContext): ChatMessage[] {
    const conversation = ctx.transcript.map((m) => `${m.role === 'assistant' ? 'Q' : 'A'}: ${clip(m.content, 500)}`);
    return [
        { role: 'system', content: CLOSING_PROMPT },
        {
            role: 'user',
            content: `${buildContextText(ctx)}\n\nThe follow-up conversation:\n${conversation.join('\n')}\n\nWrite the routine.`,
        },
    ];
}
