// Safety checks that never depend on the model. A small local model cannot be trusted to
// notice an emergency or to stay away from treatment advice, so both are enforced in code.

// ---------------------------------------------------------------- emergencies

export const EMERGENCY_MESSAGE =
    "What you've described may be serious. Please contact your medic right away. " +
    "If you can't reach them, or you feel worse, call your local emergency number.";

// Things that should send a patient to their medic straight away. Deliberately broad:
// a false alarm costs one message, a missed emergency costs far more.
const NEAR = '[^.,;!?\\n]{0,25}'; // a few words, without crossing into the next clause
const CHEST_SYMPTOM = '(?:pain|(?<!blood )pressure|tight|crush|squeez|heav|discomfort|hurt)';
const EMERGENCY_PATTERNS: RegExp[] = [
    // chest pain and pressure, in either word order ("blood pressure" is not this)
    new RegExp(`\\bchest${NEAR}${CHEST_SYMPTOM}`, 'g'),
    new RegExp(`\\b${CHEST_SYMPTOM}${NEAR}\\b(?:in|on|across|around)\\b${NEAR}\\bchest\\b`, 'g'),
    // trouble breathing
    /\bshort(?:ness)? of breath\b|\bbreathless|\bgasping\b|\bchoking\b|\bcan'?t catch my breath\b/g,
    /\b(?:can'?t|cannot|unable to|struggling to|hard to|difficult to|difficulty|trouble|hurts? to) breath(?:e|ing)\b/g,
    // signs of a stroke
    /\bslurred|\bdroop|\bparaly|\bstroke\b|\bthunderclap\b|\bworst headache (?:of|in) my life\b/g,
    /\b(?:face|one side|left arm|right arm|half of my body)[^.,;!?\n]{0,20}\b(?:numb|weak|dead)/g,
    /\b(?:can'?t|cannot|unable to) (?:speak|talk|move (?:my )?(?:arm|leg|face))\b/g,
    // fainting, seizures
    /\bfaint(?:ed|ing)\b|\bpass(?:ed|ing) out\b|\bblack(?:ed|ing) out\b|\bunconscious|\bunresponsive|\bcollaps(?:ed|ing)\b|\bseizure|\bconvuls/g,
    // severe bleeding
    /\b(?:severe|heavy|heavily|profuse|uncontrolled)\b[^.,;!?\n]{0,15}\bbleed|\bbleed\w*[^.,;!?\n]{0,20}\b(?:won'?t stop|will not stop|heavily|a lot|uncontrol)/g,
    /\b(?:coughing|cough(?:ed)? up|vomiting|vomit(?:ed)?|throwing up) (?:up )?blood\b|\bblood in (?:my )?(?:vomit|stool)\b/g,
    // severe allergic reaction, poisoning
    /\banaphyla|\b(?:throat|tongue)\b[^.,;!?\n]{0,15}\b(?:clos|swell|swollen)|\bswelling (?:of|in) (?:my )?(?:throat|tongue|face)\b|\boverdos|\bpoisoned\b/g,
    // thoughts of self-harm
    /\bsuicid|\bkill myself\b|\bend my (?:own )?life\b|\bwant to die\b|\bself[- ]harm|\b(?:hurt|harm) myself\b|\btake my own life\b|\bdon'?t want to (?:live|be alive)\b/g,
];

// A mention is ignored when the patient is saying they do NOT have it ("no chest pain or
// trouble breathing"). The word must sit in the same clause, a few words before it, with
// nothing like "but" or "and" in between that starts a new thought ("no fever and chest pain").
const NEGATION =
    /\b(?:no|not|never|without|none|neither|nor|denies|denied|don't|doesn't|didn't|haven't|hasn't|isn't|aren't|wasn't|free of|negative for)\b/g;
const NEW_THOUGHT = /\b(?:and|but|however|although|though|yet|except|then|also|plus|with)\b/;

function isNegated(text: string, matchStart: number): boolean {
    const clause = text.slice(0, matchStart).split(/[.;!?\n,:()]/).pop() ?? '';
    const nearby = clause.trim().split(/\s+/).slice(-6).join(' ');
    let negationEnd = -1;
    for (const m of nearby.matchAll(NEGATION)) negationEnd = m.index + m[0].length;
    return negationEnd !== -1 && !NEW_THOUGHT.test(nearby.slice(negationEnd));
}

/** True if any of the texts describes something that could be an emergency. */
export function detectEmergency(...texts: (string | null | undefined)[]): boolean {
    for (const raw of texts) {
        if (!raw) continue;
        const text = raw.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
        for (const pattern of EMERGENCY_PATTERNS) {
            for (const match of text.matchAll(pattern)) {
                if (!isNegated(text, match.index)) return true;
            }
        }
    }
    return false;
}

// ---------------------------------------------------------------- closing guidance

// A routine step is dropped if it mentions medicine or treatment, names a cause, or reassures.
// The prompt already asks the model not to; this is the backstop for when it does anyway.
const FORBIDDEN_TIP = new RegExp(
    [
        String.raw`\b(?:medic(?:ine|ation|al)|drug|pill|tablet|capsule|dose|dosage|painkiller|pain[- ]relie\w*|antibiotic|antihistamine|steroid|supplement|vitamin|herbal|remed(?:y|ies)|cream|ointment|prescri\w*|over[- ]the[- ]counter|otc|inhaler|inject\w*|surger\w*|therap\w*|treatment|diagnos\w*)`,
        String.raw`\b(?:ibuprofen|paracetamol|acetaminophen|tylenol|advil|aspirin|naproxen|panadol|motrin|antacid)`,
        String.raw`\b\d+(?:\.\d+)?\s?(?:mg|mcg|ml|iu)\b`,
        String.raw`\byou (?:may|might|could|probably|likely) (?:have|be suffering)`,
        String.raw`\b(?:sounds|looks|seems) like\b|\bcaused by\b|\bdue to\b|\blikely (?:a|an|to be)\b`,
        String.raw`\bnothing to worry|\bnot serious|\bharmless|\bno need to (?:worry|see)`,
    ].join('|'),
    'i',
);

const MAX_TIPS = 6;
const MAX_TIP_LENGTH = 300;

/** Cleans up the model's routine steps and separates the ones that are safe to show from the rest. */
export function filterTips(tips: string[]): { kept: string[]; dropped: string[] } {
    const kept: string[] = [];
    const dropped: string[] = [];
    for (const raw of tips) {
        const tip = raw.replace(/^\s*(?:(?:[-*•]|\d+[.)])\s+)+/, '').replace(/\s+/g, ' ').trim();
        if (!tip) continue;
        if (tip.length > MAX_TIP_LENGTH || FORBIDDEN_TIP.test(tip)) {
            dropped.push(tip);
            continue;
        }
        const sentence = tip[0].toUpperCase() + tip.slice(1);
        const finished = /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
        if (!kept.includes(finished) && kept.length < MAX_TIPS) kept.push(finished);
    }
    return { kept, dropped };
}

/**
 * The last message of a thread. The framing and the "contact your medic" line are fixed
 * text, not written by the model, so they are always there whatever the model produced.
 * The steps are numbered because they are a routine, in order.
 */
export function composeClosingNote(tips: string[]): string {
    if (tips.length === 0) {
        return 'Thanks, your answers are saved and your care team will review them. If it gets worse, please contact your medic.';
    }
    return [
        'Thanks, your answers are saved for your care team. Here is a simple routine to follow in the meantime:',
        ...tips.map((tip, i) => `${i + 1}. ${tip}`),
        '',
        "This is general guidance, not medical advice. If it gets worse or doesn't improve, please contact your medic.",
    ].join('\n');
}
