import { readFileSync } from 'node:fs';
import { z } from 'zod';

// Thresholds are data, not code (docs/astronaut-health-metrics-spec.md, section 3): one file,
// config/metrics.json, read by the engine here, served to the frontend by GET /metrics/config
// and, later, read by the assistant. It is validated once at startup, so a typo fails fast.
// From both src/modules/metrics and dist/modules/metrics the file is three levels up.
const FILE = new URL('../../../config/metrics.json', import.meta.url);

export const EVIDENCE_LEVELS = ['NASA_STANDARD', 'CLINICAL_GUIDELINE', 'SPACEFLIGHT_DATA', 'OUR_HEURISTIC'] as const;

const num = z.number().finite();
const text = z.string().min(1);

const common = {
    title: text,
    unit: z.string(),
    baseline_rule: text,
    tiers: z.strictObject({ green: text, yellow: text, red: text }),
    persistence: text,
    evidence_level: z.enum(EVIDENCE_LEVELS),
    evidence_note: text,
    sources: z.array(text).min(1),
    limitation: text,
    action: z.strictObject({ yellow: text, red: text }),
    stale_after_minutes: z.number().int().positive(),
    requires_gravity: z.boolean().optional(),
    explain: z.strictObject({ how: text, meaning: text, why: text }),
};

const hrResting = z.strictObject({
    ...common,
    metric_id: z.literal('hr_resting'),
    input: z.literal('sensor'),
    vital: z.literal('hr'),
    params: z.strictObject({
        rest_run_minutes: num,
        min_tracked_seconds_per_minute: num,
        quiet_fraction: num,
        rest_hold_minutes: num,
        min_resting_minutes: num,
        baseline_days: num,
        baseline_exclude_hours: num,
        baseline_min_resting_minutes: num,
        green_band_pct: num,
        green_min: num,
        green_max: num,
        yellow_sustained_minutes: num,
        absolute_sustained_minutes: num,
        red_high: num,
        red_low: num,
        red_sustained_minutes: num,
        lookback_minutes: num,
        symptom_window_minutes: num,
    }),
});

const skinTemp = z.strictObject({
    ...common,
    metric_id: z.literal('skin_temp'),
    input: z.literal('sensor'),
    vital: z.literal('bt'),
    params: z.strictObject({
        baseline_days: num,
        baseline_exclude_hours: num,
        baseline_min_days: num,
        baseline_min_minutes_per_hour: num,
        yellow_delta_c: num,
        sustained_minutes: num,
        min_minutes_with_data: num,
        core_red_c: num,
        core_fresh_hours: num,
    }),
});

const spo2 = z.strictObject({
    ...common,
    metric_id: z.literal('spo2'),
    input: z.literal('sensor'),
    vital: z.literal('bo'),
    params: z.strictObject({
        green_min: num,
        yellow_min: num,
        red_consecutive_minutes: num,
        yellow_consecutive_minutes: num,
        lookback_minutes: num,
    }),
});

const bp = z.strictObject({
    ...common,
    metric_id: z.literal('bp'),
    input: z.literal('log'),
    params: z.strictObject({
        high_red_sbp: num,
        high_red_dbp: num,
        repeat_high_sbp: num,
        repeat_high_dbp: num,
        yellow_high_sbp: num,
        yellow_high_dbp: num,
        low_sbp: num,
        low_dbp: num,
        low_map: num,
        repeat_within_hours: num,
        baseline_min_logs: num,
        baseline_days: num,
        above_baseline_yellow_mmhg: num,
        below_baseline_yellow_mmhg: num,
    }),
});

const sleep = z.strictObject({
    ...common,
    metric_id: z.literal('sleep'),
    input: z.literal('log'),
    params: z.strictObject({ window_nights: num, min_nights: num, green_hours: num, yellow_hours: num }),
});

const orthostatic = z.strictObject({
    ...common,
    metric_id: z.literal('orthostatic'),
    input: z.literal('log'),
    params: z.strictObject({ sbp_drop: num, dbp_drop: num, hr_rise_low: num, hr_rise_high: num, hr_high: num }),
});

const symptomsMetric = z.strictObject({
    ...common,
    metric_id: z.literal('symptoms'),
    input: z.literal('log'),
    params: z.strictObject({ window_hours: num, yellow_min_intensity: num }),
});

const chartLimit = z.strictObject({ bound: z.enum(['upper', 'lower']), limit: num, label: text }).nullable();

const schema = z.strictObject({
    version: z.number().int(),
    disclaimer: text,
    profiles: z
        .array(z.strictObject({ id: z.string().min(1).max(16), label: text, gravity: z.boolean(), note: text }))
        .min(1),
    default_profile: z.string(),
    /** Who a red alert is escalated to. */
    escalate_to: text,
    chart_limits: z.strictObject({ hr: chartLimit, bt: chartLimit, bo: chartLimit }),
    metrics: z.tuple([hrResting, skinTemp, spo2, bp, sleep, orthostatic, symptomsMetric]),
    symptoms: z.array(
        z.strictObject({
            id: text,
            label: text,
            red_flag: z.boolean(),
            aliases: z.array(text),
            hint: text.optional(),
        }),
    ),
    heart_symptoms: z.array(text),
    log_symptoms: z.array(
        z.strictObject({ id: text, label: text, effect: z.enum(['red', 'presyncope']) }),
    ),
    rules: z.array(
        z.strictObject({
            id: text,
            title: text,
            active: z.boolean(),
            requires: z.array(text).min(1),
            when: text,
            evidence_level: z.enum(EVIDENCE_LEVELS),
            action: text.optional(),
            inactive_reason: text.optional(),
        }),
    ),
});

export type MetricsConfig = z.infer<typeof schema>;
export type MetricConfig = MetricsConfig['metrics'][number];
export type MetricId = MetricConfig['metric_id'];
export type MetricOf<I extends MetricId> = Extract<MetricConfig, { metric_id: I }>;

/** Parses and cross-checks the config. Exported so tests can feed it a broken one. */
export function parseMetricsConfig(raw: unknown): MetricsConfig {
    const config = schema.parse(raw);
    if (!config.profiles.some((p) => p.id === config.default_profile)) {
        throw new Error(`metrics.json: default_profile "${config.default_profile}" is not a profile`);
    }
    for (const rule of config.rules) {
        if (rule.active && !rule.action) throw new Error(`metrics.json: active rule ${rule.id} needs an action`);
        if (!rule.active && !rule.inactive_reason) throw new Error(`metrics.json: inactive rule ${rule.id} needs an inactive_reason`);
    }
    const symptomIds = new Set(config.symptoms.map((s) => s.id));
    for (const id of config.heart_symptoms) {
        if (!symptomIds.has(id)) throw new Error(`metrics.json: heart_symptoms names unknown symptom ${id}`);
    }
    return config;
}

export const metricsConfig: MetricsConfig = parseMetricsConfig(JSON.parse(readFileSync(FILE, 'utf8')));

export function metric<I extends MetricId>(id: I): MetricOf<I> {
    return metricsConfig.metrics.find((m) => m.metric_id === id) as MetricOf<I>;
}

export const PROFILE_IDS = metricsConfig.profiles.map((p) => p.id);
export const profileById = (id: string) => metricsConfig.profiles.find((p) => p.id === id);
