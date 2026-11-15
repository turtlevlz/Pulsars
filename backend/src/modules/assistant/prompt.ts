import { z } from 'zod';
import type { ChatMessage } from '../../llm/client.js';

export const SYSTEM_PROMPT = `You are an intake assistant inside a health-monitoring app. A patient has logged a symptom. Your only job is to ask ONE short, plain-language follow-up question at a time, so their care team can better understand the symptom (for example: when it started, where it is, what triggers or relieves it, related symptoms, how it affects daily life).

Rules:
- Never diagnose, never name likely conditions, never recommend medication or treatment.
- Never repeat a question that was already asked (in this conversation or in earlier threads).
- The vitals are context only. Do not interpret them or comment on them.
- If the patient describes something that could be an emergency (for example chest pain, trouble breathing, fainting, signs of a stroke, severe bleeding, thoughts of self-harm), put a brief message in "question" telling them to contact emergency services or their medic right away, and set "done" to true.
- When you have enough information, set "done" to true and "question" to null.

Respond with ONLY a JSON object, nothing else: {"question": string or null, "done": boolean}`;

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
