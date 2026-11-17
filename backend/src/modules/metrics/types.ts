import type { BpValue, CoreTempValue, OrthostaticValue, Posture } from '../logs/schemas.js';
import type { MetricId } from './config.js';

export type Level = 'green' | 'yellow' | 'red' | 'gray';

export const MINUTE = 60_000;
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

/** One minute of a vital: its start (ms) and the average (heart rate, temperature) or median (SpO2). */
export interface MinutePoint {
    t: number;
    value: number;
}

/** The wrist band's motion bands for one minute, counted per second (see fitness/activity.ts classify). */
export interface MotionMinute {
    t: number;
    tracked: number;
    quiet: number;
    active: number;
}

/** A minute is quiet when almost all of its tracked seconds were still; otherwise there was movement. */
export type MotionState = 'quiet' | 'active';

export interface Logged<V> {
    /** ms */
    at: number;
    value: V;
}

/** A sleep entry as stored: ISO strings, because it went through JSON. */
export interface StoredSleep {
    bedtime: string;
    wakeTime: string;
    quality?: number;
}

export interface SymptomEvent {
    /** The picklist id this symptom was matched to, or null for free text we don't recognise. */
    id: string | null;
    name: string;
    intensity: number;
    at: number;
}

export interface Baselines {
    /** Median resting heart rate. */
    hr: { median: number; restingMinutes: number } | null;
    /** The skin temperature a person usually has at each hour of the day (UTC), null where unknown. */
    temp: { byHour: (number | null)[]; days: number } | null;
    /** Median of recent blood-pressure logs per posture (shown for context; the tiers recompute it per reading). */
    bp: Partial<Record<Posture, { sbp: number; dbp: number; n: number }>>;
}

/** Everything the evaluators read. Plain arrays sorted by time, so they can be run for any moment. */
export interface Dataset {
    hr: MinutePoint[];
    temp: MinutePoint[];
    spo2: MinutePoint[];
    /** Motion per minute; a minute that is missing has no motion data. */
    motion: Map<number, MotionState>;
    /** Minutes of rest: still for at least `rest_run_minutes` minutes in a row, this one included. */
    resting: Set<number>;
    bp: Logged<BpValue>[];
    sleep: Logged<StoredSleep>[];
    coreTemp: Logged<CoreTempValue>[];
    orthostatic: Logged<OrthostaticValue>[];
    symptoms: SymptomEvent[];
    baselines: Baselines;
    /** Orthostatic checks only make sense where there is gravity. */
    gravity: boolean;
    /** Start of the data that was fetched, to word "no data" honestly. */
    from: number;
}

export interface MetricStatus {
    metricId: MetricId;
    title: string;
    level: Level;
    /** One plain sentence on why this tier. */
    reason: string;
    /** The number the tier is based on (resting heart rate, temperature, 1-minute SpO2 median, ...). */
    value: number | null;
    /** The value as it is written for a person, e.g. "118/76 mmHg". */
    display: string | null;
    unit: string;
    /** ms of the end of the reading the tier rests on. */
    measuredAt: number | null;
    ageMinutes: number | null;
    /** The person's own set point this was compared with, if there is one. */
    baseline: { value: number | null; label: string } | null;
    quality: { motionArtifact: boolean | null; coverage: number | null; note: string | null };
    /** Machine-readable facts the cross rules use ('elevated', 'low', 'rise', 'core_fever', ...). */
    flags: string[];
    evidenceLevel: string;
    /** What to do now (yellow and red only). */
    action: string | null;
    detail: Record<string, unknown> | null;
}

export interface RuleStatus {
    ruleId: string;
    title: string;
    level: Level;
    reason: string;
    evidenceLevel: string;
    action: string | null;
    /** The metrics that raised it. */
    from: MetricId[];
}

/** One thing worth a person's attention right now: a metric at yellow or red, or a cross rule. */
export interface AlertItem {
    /** The metric id (`hr_resting`) or the rule id (`volume_loss_or_infection`). */
    ruleId: string;
    kind: 'metric' | 'rule';
    title: string;
    level: 'yellow' | 'red';
    reason: string;
    recommendedAction: string;
    /** Who to tell: set for red only. */
    escalateTo: string | null;
    evidenceLevel: string;
}

export interface Evaluation {
    statuses: MetricStatus[];
    rules: RuleStatus[];
}

export type { Posture };
