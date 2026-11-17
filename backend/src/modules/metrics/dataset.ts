import { metric, type MetricsConfig, metricsConfig } from './config.js';
import { bpBaseline, hourOf, median } from './evaluate.js';
import { POSTURES } from '../logs/schemas.js';
import { matchSymptom } from './symptoms.js';
import {
    DAY,
    HOUR,
    MINUTE,
    type Baselines,
    type Dataset,
    type Logged,
    type MinutePoint,
    type MotionMinute,
    type MotionState,
    type StoredSleep,
    type SymptomEvent,
} from './types.js';
import type { BpValue, CoreTempValue, OrthostaticValue } from '../logs/schemas.js';

/** What was read from the database, before any interpretation. */
export interface RawData {
    hr: MinutePoint[];
    temp: MinutePoint[];
    spo2: MinutePoint[];
    motion: MotionMinute[];
    logs: { kind: string; at: number; value: unknown }[];
    symptoms: { name: string; intensity: number; at: number }[];
}

/**
 * Turns a minute of wrist-band motion bands into quiet or active. Seconds without a reading are
 * not counted, and a minute with too few tracked seconds says nothing.
 */
export function motionState(m: MotionMinute, p: { min_tracked_seconds_per_minute: number; quiet_fraction: number }): MotionState | null {
    if (m.tracked < p.min_tracked_seconds_per_minute) return null;
    return m.quiet / m.tracked >= p.quiet_fraction ? 'quiet' : 'active';
}

/** Minutes of rest: this minute and the `runMinutes - 1` before it were all still. */
export function restingMinutes(motion: Map<number, MotionState>, runMinutes: number): Set<number> {
    const resting = new Set<number>();
    const times = [...motion.keys()].sort((a, b) => a - b);
    let run = 0;
    let prev = Number.NEGATIVE_INFINITY;
    for (const t of times) {
        run = motion.get(t) === 'quiet' ? (t - prev === MINUTE ? run + 1 : 1) : 0;
        if (run >= runMinutes) resting.add(t);
        prev = t;
    }
    return resting;
}

const byTime = <T extends { at: number }>(xs: T[]) => xs.sort((a, b) => a.at - b.at);

export function buildDataset(
    raw: RawData,
    baselines: Baselines,
    opts: { gravity: boolean; from: number },
    config: MetricsConfig = metricsConfig,
): Dataset {
    const hr = config.metrics[0];
    const motion = new Map<number, MotionState>();
    for (const m of raw.motion) {
        const state = motionState(m, hr.params);
        if (state) motion.set(m.t, state);
    }
    const logs = (kind: string) => raw.logs.filter((l) => l.kind === kind).map((l) => ({ at: l.at, value: l.value }));
    return {
        hr: raw.hr,
        temp: raw.temp,
        spo2: raw.spo2,
        motion,
        resting: restingMinutes(motion, hr.params.rest_run_minutes),
        bp: byTime(logs('bp') as Logged<BpValue>[]),
        sleep: byTime(logs('sleep') as Logged<StoredSleep>[]),
        coreTemp: byTime(logs('core_temp') as Logged<CoreTempValue>[]),
        orthostatic: byTime(logs('orthostatic') as Logged<OrthostaticValue>[]),
        symptoms: raw.symptoms.map((s): SymptomEvent => ({ ...s, id: matchSymptom(s.name) })),
        baselines,
        gravity: opts.gravity,
        from: opts.from,
    };
}

// ------------------------------------------------------------------ baselines (pure parts)

/** The median resting heart rate over a window, or null with too little resting data. */
export function computeHrBaseline(
    hr: MinutePoint[],
    resting: Set<number>,
    from: number,
    to: number,
    p: { baseline_min_resting_minutes: number },
): Baselines['hr'] {
    const values = hr.filter((m) => m.t >= from && m.t < to && resting.has(m.t)).map((m) => m.value);
    return values.length >= p.baseline_min_resting_minutes ? { median: median(values), restingMinutes: values.length } : null;
}

/** A person's usual skin temperature for each hour of the day (UTC): the median of that hour over the window. */
export function computeTempCurve(
    temp: MinutePoint[],
    from: number,
    to: number,
    p: { baseline_min_days: number; baseline_min_minutes_per_hour: number },
): Baselines['temp'] {
    const inWindow = temp.filter((m) => m.t >= from && m.t < to);
    const days = new Set(inWindow.map((m) => Math.floor(m.t / DAY))).size;
    if (days < p.baseline_min_days) return null;
    const hours: number[][] = Array.from({ length: 24 }, () => []);
    for (const m of inWindow) hours[hourOf(m.t)].push(m.value);
    const byHour = hours.map((xs) => (xs.length >= p.baseline_min_minutes_per_hour ? median(xs) : null));
    return byHour.some((b) => b !== null) ? { byHour, days } : null;
}

export function computeBpBaselines(logs: Logged<BpValue>[], now: number): Baselines['bp'] {
    const p = metric('bp').params;
    const out: Baselines['bp'] = {};
    for (const posture of POSTURES) {
        const b = bpBaseline(logs, posture, now + 1, p);
        if (b) out[posture] = b;
    }
    return out;
}

export const windowOf = (now: number, days: number, excludeHours: number) => ({
    from: Math.floor((now - days * DAY) / MINUTE) * MINUTE,
    to: Math.floor((now - excludeHours * HOUR) / MINUTE) * MINUTE,
});
