import { metricsConfig, metric } from '../src/modules/metrics/config.js';
import type { BpValue, CoreTempValue, OrthostaticValue } from '../src/modules/logs/schemas.js';
import {
    MINUTE,
    HOUR,
    type Baselines,
    type Dataset,
    type Logged,
    type MinutePoint,
    type MotionState,
    type StoredSleep,
    type SymptomEvent,
} from '../src/modules/metrics/types.js';

// Builders for the pure-evaluator tests: a Dataset made of a few lines, and a clock.
// NOW is 12:30 UTC on a day; the last complete minute is 12:29.
export const NOW = Date.UTC(2026, 10, 14, 12, 30, 0);
export const minuteAt = (minutesFromNow: number) => NOW + minutesFromNow * MINUTE;

export const cfg = {
    hr: metric('hr_resting'),
    temp: metric('skin_temp'),
    spo2: metric('spo2'),
    bp: metric('bp'),
    sleep: metric('sleep'),
    ortho: metric('orthostatic'),
    symptoms: metric('symptoms'),
};
export { metricsConfig };

/** `values.length` consecutive minutes that END with the minute before `endsMinutesAgo`. The last value is the newest. */
export function series(values: number[], endsMinutesAgo = 1): MinutePoint[] {
    return values.map((value, i) => ({ t: NOW - (endsMinutesAgo + values.length - 1 - i) * MINUTE, value }));
}
export const flat = (value: number, minutes: number, endsMinutesAgo = 1) => series(Array(minutes).fill(value), endsMinutesAgo);

export const baselines = (over: Partial<Baselines> = {}): Baselines => ({ hr: null, temp: null, bp: {}, ...over });
export const hrBaseline = (median: number): Baselines['hr'] => ({ median, restingMinutes: 500 });
export const tempCurve = (usual: number | ((hour: number) => number)): Baselines['temp'] => ({
    byHour: Array.from({ length: 24 }, (_, h) => (typeof usual === 'function' ? usual(h) : usual)),
    days: 7,
});

const sorted = <T extends { at: number }>(xs: T[]) => [...xs].sort((a, b) => a.at - b.at);

/** A Dataset with nothing in it. Logs are sorted by time, as buildDataset does for real data. */
export function dataset(over: Partial<Dataset> = {}): Dataset {
    const ds = {
        hr: [],
        temp: [],
        spo2: [],
        motion: new Map<number, MotionState>(),
        resting: new Set<number>(),
        bp: [],
        sleep: [],
        coreTemp: [],
        orthostatic: [],
        symptoms: [],
        baselines: baselines(),
        gravity: false,
        from: NOW - 4 * HOUR,
        ...over,
    };
    return { ...ds, bp: sorted(ds.bp), sleep: sorted(ds.sleep), coreTemp: sorted(ds.coreTemp), orthostatic: sorted(ds.orthostatic) };
}

/** Marks every minute of these points as rest (and as quiet motion). */
export function atRest(points: MinutePoint[]): Pick<Dataset, 'motion' | 'resting'> {
    return {
        motion: new Map(points.map((p) => [p.t, 'quiet' as MotionState])),
        resting: new Set(points.map((p) => p.t)),
    };
}

export const bp = (
    minutesAgo: number,
    systolic: number,
    diastolic: number,
    over: Partial<BpValue> = {},
): Logged<BpValue> => ({
    at: NOW - minutesAgo * MINUTE,
    value: { systolic, diastolic, heartRate: 70, posture: 'seated', restedFiveMinutes: true, armAtHeartLevel: true, symptoms: [], ...over },
});

export const core = (minutesAgo: number, celsius: number, site: CoreTempValue['site'] = 'oral'): Logged<CoreTempValue> => ({
    at: NOW - minutesAgo * MINUTE,
    value: { celsius, site },
});

/** A night that ended `daysAgo` days (and a bit) ago, `hours` long. */
export function night(daysAgo: number, hours: number): Logged<StoredSleep> {
    const wake = NOW - daysAgo * 24 * HOUR - 6 * HOUR; // wake-up at 06:30
    return { at: wake, value: { bedtime: new Date(wake - hours * HOUR).toISOString(), wakeTime: new Date(wake).toISOString() } };
}

export const symptom = (id: string | null, name: string, minutesAgo: number, intensity = 3): SymptomEvent => ({
    id,
    name,
    intensity,
    at: NOW - minutesAgo * MINUTE,
});

export const ortho = (
    supine: [number, number, number],
    stand1: [number, number, number],
    stand3: [number, number, number],
    symptoms: string[] = [],
    minutesAgo = 10,
): Logged<OrthostaticValue> => {
    const r = ([systolic, diastolic, heartRate]: [number, number, number]) => ({ systolic, diastolic, heartRate });
    return { at: NOW - minutesAgo * MINUTE, value: { supine: r(supine), standing1: r(stand1), standing3: r(stand3), symptoms } };
};
