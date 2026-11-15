import { describe, expect, it } from 'vitest';
import {
    CLOSING_PROMPT,
    FALLBACK_QUESTIONS,
    SYSTEM_PROMPT,
    buildClosingMessages,
    buildContextText,
    buildMessages,
    fallbackQuestion,
    parseAssistantReply,
    parseClosingTips,
    type PromptContext,
} from '../src/modules/assistant/prompt.js';

describe('parseAssistantReply', () => {
    it.each([
        ['plain JSON', '{"question":"Where does it hurt?","done":false}', { question: 'Where does it hurt?', done: false }],
        ['markdown fence', '```json\n{"question":"Where?","done":false}\n```', { question: 'Where?', done: false }],
        ['bare fence', '```\n{"question":"Where?","done":false}\n```', { question: 'Where?', done: false }],
        ['chatter around it', 'Sure! {"question":"Since when?","done":false} Hope that helps.', { question: 'Since when?', done: false }],
        ['done with no question', '{"question":null,"done":true}', { question: null, done: true }],
        ['done with a closing message', '{"question":"Please call emergency services.","done":true}', { question: 'Please call emergency services.', done: true }],
        ['missing done defaults to false', '{"question":"Any fever?"}', { question: 'Any fever?', done: false }],
        ['whitespace is trimmed', '{"question":"  Any fever?  ","done":false}', { question: 'Any fever?', done: false }],
        ['empty question + done', '{"question":"","done":true}', { question: null, done: true }],
        ['a single object wrapped in an array', '[{"question":"x","done":false}]', { question: 'x', done: false }],
    ])('parses %s', (_label, raw, expected) => {
        expect(parseAssistantReply(raw)).toEqual(expected);
    });

    it.each([
        ['not JSON', 'I think you should see a doctor.'],
        ['empty', ''],
        ['broken JSON', '{"question": "Where?", '],
        ['wrong types', '{"question": 5, "done": "yes"}'],
        ['several objects in an array', '[{"question":"a"},{"question":"b"}]'],
        ['asks nothing and is not done', '{"question":null,"done":false}'],
        ['empty question and not done', '{"question":"   ","done":false}'],
    ])('rejects %s', (_label, raw) => {
        expect(parseAssistantReply(raw)).toBeNull();
    });

    it('caps very long questions', () => {
        const reply = parseAssistantReply(JSON.stringify({ question: 'x'.repeat(5000), done: false }));
        expect(reply!.question).toHaveLength(500);
    });
});

describe('fallbackQuestion', () => {
    it('cycles through generic questions', () => {
        expect(fallbackQuestion(0)).toBe(FALLBACK_QUESTIONS[0]);
        expect(fallbackQuestion(FALLBACK_QUESTIONS.length)).toBe(FALLBACK_QUESTIONS[0]);
        expect(FALLBACK_QUESTIONS.every((q) => q.endsWith('?'))).toBe(true);
    });
});

const base: PromptContext = {
    symptom: { name: 'Headache', intensity: 4, frequency: 'several_daily', durationMinutes: 90, notes: 'behind the eyes', loggedAt: new Date('2026-11-14T10:00:00Z') },
    patient: { age: 34, weight: 65, height: 168 },
    vitalsSummary: ['Heart rate: avg 80 bpm (range 70-90, 3 readings)'],
    earlierThreads: [],
    transcript: [],
};

describe('buildContextText', () => {
    it('includes the symptom, the patient profile and the vitals', () => {
        const text = buildContextText(base);
        expect(text).toContain('Name: Headache');
        expect(text).toContain('Intensity: 4 out of 5');
        expect(text).toContain('Frequency: several daily');
        expect(text).toContain('Duration: 90 minutes');
        expect(text).toContain('"behind the eyes"');
        expect(text).toContain('age 34, weight 65 kg, height 168 cm');
        expect(text).toContain('Heart rate: avg 80 bpm');
    });

    it('omits what is unknown', () => {
        const text = buildContextText({
            ...base,
            symptom: { ...base.symptom, durationMinutes: null, notes: null },
            patient: { age: null, weight: null, height: null },
            vitalsSummary: [],
        });
        expect(text).not.toContain('Duration');
        expect(text).not.toContain('Notes');
        expect(text).toContain('no profile details');
        expect(text).toContain('No vitals were recorded');
    });

    it('lists earlier threads so the model does not repeat them', () => {
        const text = buildContextText({
            ...base,
            earlierThreads: [{ messages: [{ role: 'assistant', content: 'When did it start?' }, { role: 'patient', content: 'Monday' }] }],
        });
        expect(text).toContain('do not repeat');
        expect(text).toContain('Q: When did it start?');
        expect(text).toContain('A: Monday');
    });
});

describe('buildMessages', () => {
    it('opens with the system prompt and a context message asking for the first question', () => {
        const m = buildMessages(base);
        expect(m).toHaveLength(2);
        expect(m[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
        expect(m[1].role).toBe('user');
        expect(m[1].content).toContain('Ask the first follow-up question.');
    });

    it('replays the transcript: assistant turns as JSON, patient turns as user messages', () => {
        const m = buildMessages({
            ...base,
            transcript: [{ role: 'assistant', content: 'Since when?' }, { role: 'patient', content: 'Monday' }],
        });
        expect(m.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user']);
        expect(JSON.parse(m[2].content)).toEqual({ question: 'Since when?', done: false });
        expect(m[3].content).toBe('Monday');
        expect(m[1].content).not.toContain('Ask the first follow-up question.');
    });

    it('the system prompt forbids diagnosing and covers emergencies', () => {
        expect(SYSTEM_PROMPT).toMatch(/never diagnose/i);
        expect(SYSTEM_PROMPT).toMatch(/emergenc/i);
        expect(SYSTEM_PROMPT).toMatch(/contact their medic/i);
        expect(SYSTEM_PROMPT).toMatch(/JSON/);
    });
});

describe('parseClosingTips', () => {
    it.each([
        ['plain JSON', '{"tips":["Rest.","Drink water."]}', ['Rest.', 'Drink water.']],
        ['markdown fence', '```json\n{"tips":["Rest."]}\n```', ['Rest.']],
        ['chatter around it', 'Here you go: {"tips":["Rest."]} Take care!', ['Rest.']],
        ['no tips at all', '{"tips":[]}', []],
    ])('reads %s', (_label, raw, expected) => {
        expect(parseClosingTips(raw)).toEqual(expected);
    });

    it.each([['not JSON'], ['{"tips":"rest"}'], ['{"advice":["Rest."]}'], ['{"tips":[1,2]}'], ['{broken']])('rejects %s', (raw) => {
        expect(parseClosingTips(raw)).toBeNull();
    });
});

describe('buildClosingMessages', () => {
    const messages = buildClosingMessages({
        ...base,
        transcript: [
            { role: 'assistant', content: 'Since when?' },
            { role: 'patient', content: 'Monday' },
        ],
    });

    it('sends the symptom and the whole conversation as one request', () => {
        expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
        expect(messages[0].content).toBe(CLOSING_PROMPT);
        expect(messages[1].content).toContain('Name: Headache');
        expect(messages[1].content).toContain('Q: Since when?\nA: Monday');
    });

    it('the closing prompt allows only non-medical tips and asks for JSON', () => {
        expect(CLOSING_PROMPT).toMatch(/non-medical/i);
        expect(CLOSING_PROMPT).toMatch(/never diagnose/i);
        expect(CLOSING_PROMPT).toMatch(/never mention medicines/i);
        expect(CLOSING_PROMPT).toMatch(/"tips"/);
    });
});
