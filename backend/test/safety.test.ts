import { describe, expect, it } from 'vitest';
import { EMERGENCY_MESSAGE, composeClosingNote, detectEmergency, filterTips } from '../src/modules/assistant/safety.js';

describe('detectEmergency', () => {
    it.each([
        'Crushing pressure in my chest and I feel short of breath, my left arm is going numb.',
        'Chest discomfort',
        'I have chest pain',
        'pain in my chest',
        'my chest feels tight',
        'tightness across my chest',
        'heavy feeling in my chest',
        'pressure on my chest',
        "I can't breathe",
        'I can’t breathe', // curly apostrophe, as a phone keyboard types it
        'trouble breathing',
        'Shortness of breath',
        'it is hard to breathe at night',
        'my face is drooping',
        'slurred speech since this morning',
        'my left arm went numb',
        'I fainted this morning',
        'I passed out',
        'I had a seizure',
        "bleeding that won't stop",
        'severe bleeding from a cut',
        'coughing up blood',
        'my throat is swelling',
        'I want to die',
        'I keep thinking about suicide',
        'I think I was poisoned',
        // negation must not hide a real emergency that follows it
        'No fever and chest pain',
        'No, I have chest pain',
        "It's not sharp, more like pressure in my chest",
        "I don't feel well. Chest pain started an hour ago.",
    ])('recognises: %s', (text) => {
        expect(detectEmergency(text)).toBe(true);
    });

    it.each([
        'Headache',
        'Fatigue',
        'Dull ache behind my eyes since this afternoon.',
        'It started about two hours ago, after I skipped lunch.',
        'I feel slightly nauseous, but no vomiting.',
        'It makes it hard to concentrate at work.',
        'Resting in a dark room helps a little. Bright screens make it worse.',
        'My blood pressure is a bit high',
        'Chest is fine, blood pressure is normal',
        'My legs feel weak after the gym',
        'food poisoning last week, but I am fine now',
        // the patient saying they do NOT have it
        'No chest pain or trouble breathing, just nausea.',
        "I don't have any chest pain",
        'no shortness of breath',
        'without chest pain',
        'Not short of breath at all',
        'no fainting or dizziness',
        'I have never passed out',
    ])('leaves alone: %s', (text) => {
        expect(detectEmergency(text)).toBe(false);
    });

    it('checks every text it is given and ignores empty ones', () => {
        expect(detectEmergency('Dizziness', null, undefined, '', 'I fainted')).toBe(true);
        expect(detectEmergency('Dizziness', null, undefined, '')).toBe(false);
        expect(detectEmergency()).toBe(false);
    });

    it('tells the patient to contact their medic', () => {
        expect(EMERGENCY_MESSAGE).toMatch(/contact your medic/i);
    });
});

describe('filterTips', () => {
    it('keeps everyday suggestions, tidied into sentences', () => {
        const { kept, dropped } = filterTips(['- rest in a quiet room', '2. Drink some water.', '  Take a short walk  ']);
        expect(kept).toEqual(['Rest in a quiet room.', 'Drink some water.', 'Take a short walk.']);
        expect(dropped).toEqual([]);
    });

    it.each([
        'Take ibuprofen every six hours.',
        'Try 500 mg of paracetamol.',
        'A painkiller may help.',
        'Ask about a stronger medication.',
        'Take a vitamin supplement.',
        'Use a cooling cream on the area.',
        'Over-the-counter options can help.',
        'You may have a migraine.',
        'This sounds like tension.',
        'It is probably caused by stress.',
        'This is nothing to worry about.',
        'Physical therapy could help.',
        'x'.repeat(400),
    ])('drops: %s', (tip) => {
        const { kept, dropped } = filterTips([tip, 'Rest for a while.']);
        expect(kept).toEqual(['Rest for a while.']);
        expect(dropped).toHaveLength(1);
    });

    it('removes duplicates, empty steps and anything past six', () => {
        const { kept } = filterTips([
            'Rest.', 'rest.', '', '   ', 'Drink water.', 'Stretch gently.', 'Eat regularly.', 'Go outside.', 'Write it down.', 'Log it again tonight.', 'Sleep early.',
        ]);
        expect(kept).toEqual(['Rest.', 'Drink water.', 'Stretch gently.', 'Eat regularly.', 'Go outside.', 'Write it down.']);
    });

    it('takes off list markers but keeps a number that is part of the step', () => {
        const { kept } = filterTips(['1) rest for 10 minutes', '- 2 glasses of water', '3. Log it again in 2 hours']);
        expect(kept).toEqual(['Rest for 10 minutes.', '2 glasses of water.', 'Log it again in 2 hours.']);
    });
});

describe('composeClosingNote', () => {
    it('numbers the steps between fixed text that always sends the patient to their medic if it gets worse', () => {
        const note = composeClosingNote(['Rest for a while.', 'Drink some water.']);
        expect(note).toContain('\n1. Rest for a while.\n2. Drink some water.\n');
        expect(note).toMatch(/not medical advice/i);
        expect(note).toMatch(/contact your medic/i);
    });

    it('still closes politely when there are no steps', () => {
        const note = composeClosingNote([]);
        expect(note).toMatch(/care team will review/i);
        expect(note).toMatch(/contact your medic/i);
        expect(note).not.toMatch(/^\d+\. /m);
    });
});
