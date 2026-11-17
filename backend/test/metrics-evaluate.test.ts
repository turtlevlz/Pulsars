import { describe, expect, it } from 'vitest';
import {
    evalBp,
    evalHrResting,
    evalOrthostatic,
    evalSkinTemp,
    evalSleep,
    evalSpo2,
    evalSymptoms,
    evaluateAll,
} from '../src/modules/metrics/evaluate.js';
import { evaluateRules, raise } from '../src/modules/metrics/rules.js';
import { MINUTE } from '../src/modules/metrics/types.js';
import {
    NOW,
    atRest,
    baselines,
    bp,
    cfg,
    core,
    dataset,
    flat,
    hrBaseline,
    metricsConfig,
    minuteAt,
    night,
    ortho,
    series,
    symptom,
    tempCurve,
} from './metrics-fixtures.js';

// One table per metric: every tier edge of the spec (section 4-6) has a row. The thresholds under
// test are the ones in config/metrics.json; if a limit is changed there, the matching rows change.

describe('resting heart rate', () => {
    const hrLevel = (points: ReturnType<typeof series>, over: Parameters<typeof dataset>[0] = {}) =>
        evalHrResting(dataset({ hr: points, ...atRest(points), ...over }), cfg.hr, NOW);

    it('is green inside the +/-10% band and 50-100 bpm', () => {
        const r = hrLevel(flat(74, 40), { baselines: baselines({ hr: hrBaseline(72) }) });
        expect(r.level).toBe('green');
        expect(r.value).toBe(74);
        expect(r.baseline?.value).toBe(72);
        expect(r.evidenceLevel).toBe('OUR_HEURISTIC');
        expect(r.action).toBeNull();
    });

    it('is yellow when more than 10% off the baseline for 30 resting minutes in a row, and not before', () => {
        const base = baselines({ hr: hrBaseline(72) });
        expect(hrLevel(flat(80, 30), { baselines: base })).toMatchObject({ level: 'yellow', value: 80 });
        const short = hrLevel(flat(80, 29), { baselines: base });
        expect(short.level).toBe('green');
        expect(short.reason).toContain('has not lasted long enough');
        // 10% of 72 is 7.2: 79 is inside the band, 80 is outside
        expect(hrLevel(flat(79, 40), { baselines: base }).level).toBe('green');
        // and the other way round
        expect(hrLevel(flat(64, 30), { baselines: base }).level).toBe('yellow');
        expect(hrLevel(flat(65, 40), { baselines: base }).level).toBe('green');
    });

    it('a break in the deviation resets the 30 minutes', () => {
        const points = series([...Array(20).fill(82), 72, ...Array(9).fill(82)]);
        expect(hrLevel(points, { baselines: baselines({ hr: hrBaseline(72) }) }).level).toBe('green');
    });

    it('is yellow on the absolute limits after 10 resting minutes: above 100 or below 50', () => {
        expect(hrLevel(flat(101, 10)).level).toBe('yellow');
        expect(hrLevel(flat(101, 9)).level).toBe('green');
        expect(hrLevel(flat(100, 40)).level).toBe('green');
        expect(hrLevel(flat(49, 10)).level).toBe('yellow');
        expect(hrLevel(flat(50, 40)).level).toBe('green');
    });

    it('is red above 120 or below 40 for 10 resting minutes (and 120 / 40 themselves are only yellow)', () => {
        expect(hrLevel(flat(121, 10))).toMatchObject({ level: 'red', action: expect.stringContaining('crew medical officer') });
        expect(hrLevel(flat(121, 9)).level).toBe('green');
        expect(hrLevel(flat(120, 10)).level).toBe('yellow');
        expect(hrLevel(flat(39, 10)).level).toBe('red');
        expect(hrLevel(flat(40, 10)).level).toBe('yellow');
    });

    it('goes red on an abnormal value with chest pain, fainting or shortness of breath logged in the last 2 hours', () => {
        const high = flat(105, 12);
        const withSymptom = (id: string, name: string, ago: number) => hrLevel(high, { symptoms: [symptom(id, name, ago)] });
        expect(withSymptom('chest_pain', 'Chest pain', 30)).toMatchObject({ level: 'red', reason: expect.stringContaining('chest pain') });
        expect(withSymptom('fainting', 'Fainting', 119).level).toBe('red');
        expect(withSymptom('shortness_of_breath', 'Shortness of breath', 5).level).toBe('red');
        expect(withSymptom('chest_pain', 'Chest pain', 121).level).toBe('yellow'); // too old for red: only the 10-minute absolute limit
        expect(withSymptom('headache', 'Headache', 5).level).not.toBe('red'); // not a heart symptom
        // a normal heart rate is not made red by a symptom
        expect(hrLevel(flat(72, 12), { symptoms: [symptom('chest_pain', 'Chest pain', 5)] }).level).toBe('green');
    });

    it('is gray without resting minutes, and says why', () => {
        const points = flat(72, 40);
        const moving = new Map(points.map((p) => [p.t, 'active' as const]));
        const noRest = hrLevel(points, { motion: moving, resting: new Set() });
        expect(noRest.level).toBe('gray');
        expect(noRest.reason).toContain('No resting minutes');
        const noMotionData = hrLevel(points, { motion: new Map(), resting: new Set() });
        expect(noMotionData.level).toBe('gray');
        expect(noMotionData.reason).toContain('no motion data');
        expect(noMotionData.quality.note).toBe('no motion data');
    });

    it('is gray when the heart rate is stale or missing, never green', () => {
        const old = flat(72, 40, 30); // newest minute ended 29 minutes ago
        expect(hrLevel(old).level).toBe('gray');
        expect(hrLevel(old).reason).toContain('No heart-rate data for');
        expect(hrLevel([]).level).toBe('gray');
        expect(hrLevel(flat(72, 40, 14)).level).toBe('green'); // 14 minutes: still fresh enough
        expect(hrLevel(flat(72, 40, 17)).level).toBe('gray'); // 16 minutes since the minute ended
    });

    it('is gray when you were last at rest long ago, or only just started resting', () => {
        const rest = flat(72, 20, 90);
        const recent = flat(95, 5, 1); // moving now
        const points = [...rest, ...recent];
        const r = evalHrResting(
            dataset({ hr: points, motion: atRest(rest).motion, resting: atRest(rest).resting }),
            cfg.hr,
            NOW,
        );
        expect(r.level).toBe('gray');
        expect(r.reason).toContain('No resting heart rate in the last');
        const fresh = flat(72, 2);
        expect(hrLevel(fresh).level).toBe('gray');
        expect(hrLevel(fresh).reason).toContain('Building');
    });

    it('without a baseline it uses the absolute limits only and says the baseline is not established', () => {
        const r = hrLevel(flat(72, 40));
        expect(r.level).toBe('green');
        expect(r.reason).toContain('baseline is not established');
        expect(r.baseline?.label).toBe('not established yet');
    });

    it('never uses the current, incomplete minute', () => {
        // a bad reading in the minute that is still filling (12:30) is ignored at 12:30:20
        const points = [...flat(72, 40, 1), { t: NOW, value: 140 }];
        const r = evalHrResting(dataset({ hr: points, ...atRest(points) }), cfg.hr, NOW + 20_000);
        expect(r.level).toBe('green');
    });

    it('reports the data age and the sensor coverage', () => {
        const r = hrLevel(flat(72, 40, 3));
        expect(r.measuredAt).toBe(NOW - 2 * MINUTE);
        expect(r.ageMinutes).toBe(2);
        expect(r.quality.coverage).toBe(0.8); // 8 of the last 10 minutes have readings
        expect(hrLevel(flat(72, 40, 1)).quality.coverage).toBe(1);
    });
});

describe('skin temperature', () => {
    // the person's usual is 33.0 °C at every hour
    const usual = baselines({ temp: tempCurve(33) });
    const tempLevel = (points: ReturnType<typeof series>, over: Parameters<typeof dataset>[0] = {}) =>
        evalSkinTemp(dataset({ temp: points, baselines: usual, ...over }), cfg.temp, NOW);

    it('is green within the personal curve and yellow from 0.5 °C above it, sustained for 30 minutes', () => {
        expect(tempLevel(flat(33.2, 40)).level).toBe('green');
        expect(tempLevel(flat(33.49, 40)).level).toBe('green');
        const y = tempLevel(flat(33.5, 40));
        expect(y).toMatchObject({ level: 'yellow', flags: ['rise'] });
        expect(y.reason).toContain('thermometer');
        expect(y.action).toContain('thermometer');
    });

    it('needs the rise to last: a short rise, or a rise in only part of the window, is not enough', () => {
        // 12 hot minutes at the end of a normal window: the median of the 30 is normal
        expect(tempLevel(series([...Array(18).fill(33.1), ...Array(12).fill(34.5)])).level).toBe('green');
        // 20 hot minutes of 30: the median is hot
        expect(tempLevel(series([...Array(10).fill(33.1), ...Array(20).fill(34.0)])).level).toBe('yellow');
    });

    it('is NEVER red from the band, however high', () => {
        const r = tempLevel(flat(38.5, 40));
        expect(r.level).toBe('yellow');
        expect(r.level).not.toBe('red');
    });

    it('is red only from a core or oral temperature of 38 °C or more that was logged', () => {
        expect(tempLevel(flat(33.0, 40), { coreTemp: [core(30, 38.0)] })).toMatchObject({ level: 'red', flags: ['core_fever'], value: 38 });
        expect(tempLevel(flat(33.0, 40), { coreTemp: [core(30, 37.9)] }).level).toBe('green');
        // a fever log from 7 hours ago has expired (6 hours)
        expect(tempLevel(flat(33.0, 40), { coreTemp: [core(7 * 60, 38.4)] }).level).toBe('green');
        expect(tempLevel(flat(33.0, 40), { coreTemp: [core(5 * 60, 38.4)] }).level).toBe('red');
        // the logged fever stands even when the band has gone quiet
        expect(tempLevel([], { coreTemp: [core(10, 38.6)] }).level).toBe('red');
    });

    it('mentions a normal thermometer reading next to a rise on the band', () => {
        const r = tempLevel(flat(34, 40), { coreTemp: [core(30, 37.2)] });
        expect(r.level).toBe('yellow');
        expect(r.reason).toContain('37.2');
    });

    it('compares with the same hour of the day, not a single absolute limit', () => {
        // 34.0 °C is normal at 12:00 UTC for this person and a rise at 03:00
        const curve = baselines({ temp: tempCurve((h) => (h === 12 ? 34.0 : 33.0)) });
        expect(evalSkinTemp(dataset({ temp: flat(34.0, 40), baselines: curve }), cfg.temp, NOW).level).toBe('green');
        expect(evalSkinTemp(dataset({ temp: flat(34.0, 40), baselines: baselines({ temp: tempCurve(33) }) }), cfg.temp, NOW).level).toBe('yellow');
    });

    it('is gray without a baseline, with too little recent data, or when stale', () => {
        const noBase = evalSkinTemp(dataset({ temp: flat(36, 40) }), cfg.temp, NOW);
        expect(noBase.level).toBe('gray');
        expect(noBase.reason).toContain('baseline is not established');
        expect(tempLevel(flat(33, 10)).level).toBe('gray'); // 10 of 15 minutes needed
        expect(tempLevel(flat(33, 15)).level).toBe('green');
        expect(tempLevel(flat(33, 40, 30)).level).toBe('gray');
        expect(tempLevel([]).level).toBe('gray');
    });
});

describe('blood oxygen', () => {
    const spo2Level = (points: ReturnType<typeof series>, motion = new Map<number, 'quiet' | 'active'>()) =>
        evalSpo2(dataset({ spo2: points, motion }), cfg.spo2, NOW);

    it('is green at 95 and above, yellow at 90-94 (two minutes in a row), red below 90 (three)', () => {
        expect(spo2Level(flat(97, 10)).level).toBe('green');
        expect(spo2Level(flat(95, 10)).level).toBe('green');
        expect(spo2Level(flat(94, 10)).level).toBe('yellow');
        expect(spo2Level(flat(90, 10)).level).toBe('yellow'); // 90 is not below 90
        expect(spo2Level(flat(89, 10)).level).toBe('red');
        expect(spo2Level(flat(89, 3)).level).toBe('red');
        expect(spo2Level(flat(89, 2)).level).toBe('yellow'); // only two minutes: never red
    });

    it('never goes red or yellow on a single reading', () => {
        const oneBad = spo2Level(series([97, 97, 97, 97, 85]));
        expect(oneBad.level).toBe('green');
        expect(oneBad.reason).toContain('single low minute');
        expect(spo2Level(series([97, 97, 97, 89, 89])).level).toBe('yellow');
        expect(spo2Level(series([89, 97, 89, 89])).level).toBe('yellow');
        expect(spo2Level(series([85])).level).toBe('gray'); // one usable minute: not enough to judge
    });

    it('skips minutes with motion instead of counting them', () => {
        const pts = series([89, 89, 80, 89]);
        const motion = new Map([[pts[2].t, 'active' as const]]);
        const r = spo2Level(pts, motion);
        expect(r.level).toBe('red'); // the moving minute (80) is skipped, the three still minutes count
        expect(r.detail).toMatchObject({ usableMinutes: 3, skippedForMotion: 1 });
        // all minutes moving: nothing to judge
        const allMoving = spo2Level(pts, new Map(pts.map((p) => [p.t, 'active' as const])));
        expect(allMoving.level).toBe('gray');
        expect(allMoving.quality.motionArtifact).toBe(true);
    });

    it('is gray when the data is stale or missing', () => {
        expect(spo2Level(flat(97, 10, 15)).level).toBe('gray');
        expect(spo2Level([]).level).toBe('gray');
        expect(spo2Level(flat(97, 10, 9)).level).toBe('green');
    });
});

describe('blood pressure', () => {
    const bpLevel = (logs: ReturnType<typeof bp>[], over: Parameters<typeof dataset>[0] = {}) =>
        evalBp(dataset({ bp: logs, ...over }), cfg.bp, NOW);

    it.each([
        // [systolic, diastolic, expected level]
        [118, 76, 'green'],
        [129, 79, 'green'],
        [130, 79, 'yellow'],
        [129, 80, 'yellow'],
        [139, 89, 'yellow'],
        [140, 89, 'yellow'], // a first reading of 140: yellow, red needs a repeat
        [139, 90, 'yellow'],
        [179, 119, 'yellow'],
        [180, 100, 'red'],
        [150, 120, 'red'],
        [90, 60, 'green'],
        [89, 60, 'yellow'],
        [90, 59, 'yellow'],
        [88, 58, 'yellow'], // low, no symptoms
    ] as const)('%i/%i alone (confirmed technique, nothing before it) is %s', (sbp, dbp, level) => {
        expect(bpLevel([bp(5, sbp, dbp)]).level).toBe(level);
    });

    it('is red on 140/90 or more on repeat, yellow when it is only the first', () => {
        expect(bpLevel([bp(120, 142, 88), bp(5, 144, 92)])).toMatchObject({ level: 'red' });
        expect(bpLevel([bp(120, 120, 78), bp(5, 144, 92)]).level).toBe('yellow');
        // the earlier reading must be within 24 hours
        expect(bpLevel([bp(25 * 60, 150, 95), bp(5, 144, 92)]).level).toBe('yellow');
        expect(bpLevel([bp(23 * 60, 150, 95), bp(5, 144, 92)]).level).toBe('red');
    });

    it('caps numbers from an unconfirmed technique at yellow', () => {
        expect(bpLevel([bp(120, 142, 88), bp(5, 144, 92, { restedFiveMinutes: false })])).toMatchObject({
            level: 'yellow',
            reason: expect.stringContaining('technique was not confirmed'),
            quality: { note: 'technique not confirmed' },
        });
        expect(bpLevel([bp(5, 185, 110, { armAtHeartLevel: false })]).level).toBe('yellow');
        // unless the severe value was already seen before
        expect(bpLevel([bp(60, 150, 95), bp(5, 185, 110, { armAtHeartLevel: false })]).level).toBe('red');
    });

    it('is red with chest pain, neurological symptoms or fainting, whatever the numbers', () => {
        for (const s of ['chest_pain', 'neurological', 'fainting']) {
            expect(bpLevel([bp(5, 112, 72, { symptoms: [s] })]).level).toBe('red');
        }
        // technique does not suppress a symptom
        expect(bpLevel([bp(5, 112, 72, { symptoms: ['fainting'], restedFiveMinutes: false })]).level).toBe('red');
    });

    it('low pressure is yellow alone and red with dizziness, near-fainting, confusion or blurred vision', () => {
        expect(bpLevel([bp(5, 86, 56)]).level).toBe('yellow');
        for (const s of ['dizziness', 'near_fainting', 'confusion', 'blurred_vision']) {
            expect(bpLevel([bp(5, 86, 56, { symptoms: [s] })]).level).toBe('red');
        }
        // dizziness with a normal pressure is only yellow
        expect(bpLevel([bp(5, 112, 72, { symptoms: ['dizziness'] })]).level).toBe('yellow');
    });

    it('a mean arterial pressure below 65 on repeat is red', () => {
        const low = (ago: number) => bp(ago, 80, 55); // MAP 63.3
        expect(bpLevel([low(60), low(5)]).level).toBe('red');
        expect(bpLevel([low(5)]).level).toBe('yellow');
        expect(bpLevel([low(5)]).detail).toMatchObject({ map: 63.3 });
    });

    it('compares with your own baseline in the same posture', () => {
        const history = [bp(3000, 110, 70), bp(2000, 112, 72), bp(1000, 108, 68)]; // baseline 110
        expect(bpLevel([...history, bp(5, 119, 75)]).level).toBe('green'); // +9
        expect(bpLevel([...history, bp(5, 121, 75)]).level).toBe('yellow'); // +11: above your usual
        expect(bpLevel([...history, bp(5, 90, 62)]).level).toBe('yellow'); // 20 below
        expect(bpLevel([...history, bp(5, 91, 62)]).level).toBe('green'); // 19 below
        // another posture has its own baseline (none yet)
        const standing = bpLevel([...history, bp(5, 121, 75, { posture: 'standing' })]);
        expect(standing.level).toBe('green');
        expect(standing.reason).toContain('not established');
    });

    it('computes the mean arterial pressure', () => {
        expect(bpLevel([bp(5, 120, 80)]).detail).toMatchObject({ map: 93.3 });
    });

    it('is gray when nothing was logged or the last log is old', () => {
        expect(bpLevel([]).level).toBe('gray');
        const old = bpLevel([bp(37 * 60, 118, 76)]);
        expect(old.level).toBe('gray');
        expect(old.display).toContain('118/76');
        expect(bpLevel([bp(35 * 60, 118, 76)]).level).toBe('green');
    });

    it('flags low and high for the cross rule', () => {
        expect(bpLevel([bp(5, 86, 56)]).flags).toEqual(['low']);
        expect(bpLevel([bp(5, 135, 85)]).flags).toEqual(['high']);
        expect(bpLevel([bp(5, 118, 76)]).flags).toEqual([]);
    });
});

describe('sleep', () => {
    const sleepLevel = (nights: ReturnType<typeof night>[]) => evalSleep(dataset({ sleep: nights }), cfg.sleep, NOW);
    const week = (hours: number) => [0, 1, 2, 3, 4, 5, 6].map((d) => night(d, hours));

    it('uses the 7-day average: green from 7 h, yellow 6-7 h, red below 6 h', () => {
        expect(sleepLevel(week(7.5)).level).toBe('green');
        expect(sleepLevel(week(7)).level).toBe('green');
        expect(sleepLevel(week(6.99)).level).toBe('yellow');
        expect(sleepLevel(week(6)).level).toBe('yellow');
        expect(sleepLevel(week(5.99)).level).toBe('red');
        expect(sleepLevel(week(5)).action).toContain('crew medical officer');
    });

    it('is the average, not a single night', () => {
        const mixed = [night(0, 4), night(1, 8), night(2, 8), night(3, 8), night(4, 8), night(5, 8), night(6, 8)];
        expect(sleepLevel(mixed).level).toBe('green');
        expect(sleepLevel(mixed).value).toBeCloseTo(7.4, 1);
    });

    it('needs 3 nights, and ignores nights older than 7 days', () => {
        expect(sleepLevel([night(0, 5), night(1, 5)]).level).toBe('gray');
        expect(sleepLevel([night(0, 5), night(1, 5), night(2, 5)]).level).toBe('red');
        const withOld = [night(0, 5), night(1, 5), night(2, 5), night(9, 9), night(10, 9)];
        expect(sleepLevel(withOld).level).toBe('red');
        expect(sleepLevel([]).level).toBe('gray');
    });

    it('is gray when the last night is more than 48 hours old', () => {
        const old = [night(3, 8), night(4, 8), night(5, 8), night(6, 8)];
        expect(sleepLevel(old).level).toBe('gray');
        expect(sleepLevel(old).reason).toContain('Log last night');
    });

    it('counts two entries on the same morning (a nap) as one night', () => {
        const withNap = [night(0, 5), { ...night(0, 1), at: night(0, 1).at + 60_000 }, night(1, 8), night(2, 8)];
        expect(sleepLevel(withNap).detail).toEqual({ nights: 3 });
    });
});

describe('orthostatic check', () => {
    const orthoLevel = (log: ReturnType<typeof ortho>) => evalOrthostatic(dataset({ orthostatic: [log], gravity: true }), cfg.ortho, NOW);

    it('is green below a 20 systolic / 10 diastolic drop and yellow at the definition, without symptoms', () => {
        expect(orthoLevel(ortho([118, 74, 64], [100, 66, 72], [99, 66, 74])).level).toBe('green'); // 19/8
        expect(orthoLevel(ortho([118, 74, 64], [98, 66, 76], [100, 66, 74])).level).toBe('yellow'); // 20 systolic
        expect(orthoLevel(ortho([118, 74, 64], [110, 64, 76], [112, 66, 74])).level).toBe('yellow'); // 10 diastolic
        expect(orthoLevel(ortho([118, 74, 64], [110, 65, 76], [112, 66, 74])).level).toBe('green'); // 9
    });

    it('is red with the drop plus dizziness, near-fainting, confusion or blurred vision, or with any fainting', () => {
        expect(orthoLevel(ortho([118, 74, 64], [94, 66, 80], [96, 66, 84], ['dizziness'])).level).toBe('red');
        expect(orthoLevel(ortho([118, 74, 64], [100, 66, 80], [96, 66, 84], ['blurred_vision'])).level).toBe('red');
        expect(orthoLevel(ortho([118, 74, 64], [116, 72, 70], [117, 73, 70], ['fainting'])).level).toBe('red');
        // symptoms without a drop: a prompt, not red
        expect(orthoLevel(ortho([118, 74, 64], [116, 72, 70], [117, 73, 70], ['dizziness'])).level).toBe('yellow');
    });

    it('flags the heart-rate response of a drop', () => {
        const flat = orthoLevel(ortho([118, 74, 64], [94, 66, 68], [96, 66, 70])); // rise 6
        expect(flat.flags).toEqual(['autonomic_pattern']);
        const big = orthoLevel(ortho([118, 74, 64], [94, 66, 90], [96, 66, 99])); // rise 35
        expect(big.flags).toEqual(['volume_or_pots_pattern']);
        // no drop, no flags
        expect(orthoLevel(ortho([118, 74, 64], [116, 72, 90], [117, 73, 99])).flags).toEqual([]);
    });

    it('is only evaluated where there is gravity, and is gray when old or missing', () => {
        const ds = dataset({ orthostatic: [ortho([118, 74, 64], [94, 66, 90], [96, 66, 90])] });
        expect(evaluateAll(ds, NOW).statuses.map((s) => s.metricId)).not.toContain('orthostatic');
        expect(evaluateAll({ ...ds, gravity: true }, NOW).statuses.map((s) => s.metricId)).toContain('orthostatic');
        expect(evalOrthostatic(dataset({ gravity: true }), cfg.ortho, NOW).level).toBe('gray');
        expect(orthoLevel(ortho([118, 74, 64], [94, 66, 90], [96, 66, 90], [], 4 * 24 * 60)).level).toBe('gray');
    });
});

describe('symptoms', () => {
    const symptomLevel = (...events: ReturnType<typeof symptom>[]) => evalSymptoms(dataset({ symptoms: events }), cfg.symptoms, NOW);

    it('is red for chest pain, fainting or a sudden vision change, at any severity, for 12 hours', () => {
        expect(symptomLevel(symptom('chest_pain', 'Chest pain', 60, 1)).level).toBe('red');
        expect(symptomLevel(symptom('fainting', 'Fainting', 700, 1)).level).toBe('red');
        expect(symptomLevel(symptom('fainting', 'Fainting', 721, 1)).level).toBe('green');
        expect(symptomLevel(symptom('vision_change', 'Sudden vision change', 60, 2)).level).toBe('red');
    });

    it('is yellow for a symptom of severity 3 or more, green for milder ones or none', () => {
        expect(symptomLevel(symptom('headache', 'Headache', 60, 3)).level).toBe('yellow');
        expect(symptomLevel(symptom('headache', 'Headache', 60, 2)).level).toBe('green');
        expect(symptomLevel().level).toBe('green');
        expect(symptomLevel().reason).toContain('No symptoms reported');
    });

    it('recognises a symptom logged under an older name', () => {
        expect(symptomLevel(symptom('chest_pain', 'Chest discomfort', 30, 2)).level).toBe('red');
    });
});

describe('cross rules', () => {
    const hr = (points: ReturnType<typeof series>) => ({ hr: points, ...atRest(points), baselines: baselines({ hr: hrBaseline(66), temp: tempCurve(33) }) });
    const scenario = (over: Parameters<typeof dataset>[0] = {}) => {
        const points = flat(80, 30); // 21% above 66, sustained 30 minutes: yellow, elevated
        return dataset({ ...hr(points), temp: flat(34, 40), bp: [bp(10, 86, 56)], ...over });
    };

    it('raises low pressure + a raised resting heart rate + a temperature rise one level: red', () => {
        const ev = evaluateAll(scenario(), NOW);
        const levels = Object.fromEntries(ev.statuses.map((s) => [s.metricId, s.level]));
        expect(levels).toMatchObject({ hr_resting: 'yellow', skin_temp: 'yellow', bp: 'yellow' });
        expect(ev.rules).toHaveLength(1);
        expect(ev.rules[0]).toMatchObject({
            ruleId: 'volume_loss_or_infection',
            level: 'red',
            from: ['bp', 'hr_resting', 'skin_temp'],
            evidenceLevel: 'OUR_HEURISTIC',
        });
    });

    it('a logged core fever counts as the temperature signal', () => {
        const ev = evaluateAll(scenario({ temp: [], coreTemp: [core(20, 38.3)] }), NOW);
        expect(ev.rules.map((r) => r.ruleId)).toEqual(['volume_loss_or_infection']);
    });

    it('needs all three: any one missing means no cross alert', () => {
        expect(evaluateAll(scenario({ bp: [bp(10, 118, 76)] }), NOW).rules).toEqual([]); // pressure normal
        expect(evaluateAll(scenario({ temp: flat(33, 40) }), NOW).rules).toEqual([]); // no temperature rise
        expect(evaluateAll(scenario({ baselines: baselines({ hr: hrBaseline(80), temp: tempCurve(33) }) }), NOW).rules).toEqual([]); // heart rate normal
    });

    it('raise() goes up one level and stops at red', () => {
        expect(raise(['yellow', 'green'])).toBe('red');
        expect(raise(['red', 'yellow'])).toBe('red');
        expect(raise(['green', 'gray'])).toBe('yellow');
        expect(raise(['yellow'], 0)).toBe('yellow');
    });

    it('rules that need cabin sensors or questionnaires are declared inactive, not silently on', () => {
        const inactive = metricsConfig.rules.filter((r) => !r.active).map((r) => r.id);
        expect(inactive).toEqual(expect.arrayContaining(['crew_stress', 'environmental_hypoxia', 'headache_co2', 'defer_task', 'kss_pvt_mismatch']));
        for (const r of metricsConfig.rules.filter((x) => !x.active)) expect(r.inactive_reason).toBeTruthy();
        expect(evaluateRules([], metricsConfig)).toEqual([]);
    });
});

describe('evaluateAll', () => {
    it('lists every metric in config order, each with an evidence level and a tier word', () => {
        const ev = evaluateAll(dataset(), NOW);
        expect(ev.statuses.map((s) => s.metricId)).toEqual(['hr_resting', 'skin_temp', 'spo2', 'bp', 'sleep', 'symptoms']);
        for (const s of ev.statuses) {
            expect(['green', 'yellow', 'red', 'gray']).toContain(s.level);
            expect(s.evidenceLevel).toMatch(/^(NASA_STANDARD|CLINICAL_GUIDELINE|SPACEFLIGHT_DATA|OUR_HEURISTIC)$/);
        }
        // with no data at all, nothing is green except the symptom log's "nothing reported"
        expect(ev.statuses.filter((s) => s.level === 'green').map((s) => s.metricId)).toEqual(['symptoms']);
    });
});
