import type { FitnessWindow } from './schemas.js';

const bands = ['light', 'moderate', 'high'] as const;
const second = 1000;
export const contextRadiusMs = 30 * second;

export type Intensity = Record<(typeof bands)[number], number>;
type ContextSlot = [pulseBpm: number | null, skinTempC: number | null] | null;
export type ObservedWindow = { recordedAt: Date; bands: number[]; context: ContextSlot[] };
type EventKind = 'activity' | 'quiet' | 'gap';
type Segment = { kind: EventKind; start: number; end: number; intensity: Intensity };
type Reading = { at: number; value: number };

export const emptyIntensity = (): Intensity => ({ light: 0, moderate: 0, high: 0 });
export const activeSeconds = (intensity: Intensity) => intensity.light + intensity.moderate + intensity.high;

export function classify(samples: FitnessWindow['samples']) {
    const levels = samples.map(sample => {
        if (sample?.motion_rms_g == null || sample.gyro_rms_dps == null) return -1;
        const { motion_rms_g: g, gyro_rms_dps: dps } = sample;
        if (g >= 0.35 || dps >= 80) return 3;
        if (g >= 0.15 || dps >= 35) return 2;
        if (g >= 0.06 || dps >= 15) return 1;
        return 0;
    });
    return levels.filter(level => level > 0).length >= 5 ? levels : levels.map(level => Math.min(level, 0));
}

function atOrAfter(readings: Reading[], at: number) {
    let lo = 0;
    let hi = readings.length;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (readings[mid].at < at) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function metricFor(segment: Segment, readings: Reading[]) {
    const index = atOrAfter(readings, segment.start);
    const next = readings[index];
    if (next && next.at < segment.end) {
        return { value: next.value, recordedAt: new Date(next.at), relation: 'during' as const };
    }
    if (segment.kind !== 'activity') return null;
    const prior = readings[index - 1];
    const before = prior ? segment.start - prior.at : Infinity;
    const after = next ? next.at - segment.end : Infinity;
    if (prior && before <= contextRadiusMs && before <= after) {
        return { value: prior.value, recordedAt: new Date(prior.at), relation: 'before' as const };
    }
    if (next && after <= contextRadiusMs) {
        return { value: next.value, recordedAt: new Date(next.at), relation: 'after' as const };
    }
    return null;
}

export function analyzeDay(windows: ObservedWindow[], from: Date, to: Date) {
    const start = from.getTime();
    const end = to.getTime();
    const segments: Segment[] = [];
    const pulses: Reading[] = [];
    const temperatures: Reading[] = [];
    const intensity = emptyIntensity();
    let trackedSeconds = 0;
    let lastAt: number | undefined;
    let lastContextAt = -Infinity;

    function append(kind: EventKind, fromMs: number, toMs: number, band?: keyof Intensity) {
        let segment = segments.at(-1);
        if (!segment || segment.kind !== kind || segment.end !== fromMs) {
            segment = { kind, start: fromMs, end: toMs, intensity: emptyIntensity() };
            segments.push(segment);
        } else {
            segment.end = toMs;
        }
        if (band) segment.intensity[band]++;
    }

    for (const window of windows) {
        for (const [slot, level] of window.bands.entries()) {
            const at = window.recordedAt.getTime() + slot * second;
            if (at <= lastContextAt) continue;
            lastContextAt = at;
            const [pulse, skin] = window.context[slot] ?? [null, null];
            if (pulse !== null) pulses.push({ at, value: pulse });
            if (skin !== null) temperatures.push({ at, value: skin });

            if (at < start || at >= end) continue;
            if (lastAt !== undefined && at > lastAt + second) {
                append('gap', lastAt + second, at);
            }
            lastAt = at;

            const band = bands[level - 1];
            if (level >= 0) trackedSeconds++;
            if (band) intensity[band]++;
            append(level < 0 ? 'gap' : band ? 'activity' : 'quiet', at, Math.min(at + second, end), band);
        }
    }

    return {
        trackedSeconds, activeSeconds: activeSeconds(intensity), intensity,
        timeline: segments.map(segment => {
            const event = { startedAt: new Date(segment.start), endedAt: new Date(segment.end) };
            if (segment.kind === 'gap') return { ...event, kind: segment.kind };
            const context = {
                pulse: metricFor(segment, pulses),
                skinTemperature: metricFor(segment, temperatures),
            };
            if (segment.kind === 'quiet') return { ...event, ...context, kind: segment.kind };
            const { intensity } = segment;
            const band = intensity.high ? 'high' : intensity.moderate ? 'moderate' : 'light';
            return { ...event, ...context, kind: segment.kind, band, activeSeconds: activeSeconds(intensity), intensity };
        }),
    };
}
