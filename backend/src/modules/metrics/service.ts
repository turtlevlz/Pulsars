import { requireUser } from '../users/service.js';
import { ensureBaselines } from './baselines.js';
import { metricsConfig, profileById, type MetricsConfig } from './config.js';
import { loadRaw } from './data.js';
import { buildDataset } from './dataset.js';
import { evaluateAll } from './evaluate.js';
import { DAY, HOUR, MINUTE, type AlertItem, type Evaluation } from './types.js';

/** What the evaluators look back over before the moment they judge (heart rate: 3 hours + rest run). */
const LOOKBACK_MS = 4 * HOUR;
const LOGS_LOOKBACK_MS = 31 * DAY; // blood-pressure baseline: 30 days
const SYMPTOMS_LOOKBACK_MS = 36 * HOUR;

/** The metrics and rules that are yellow or red, as alerts (each with the one action to take). */
export function alertItems(ev: Evaluation, config: MetricsConfig = metricsConfig): AlertItem[] {
    const items: AlertItem[] = [];
    for (const s of ev.statuses) {
        if (s.level !== 'yellow' && s.level !== 'red') continue;
        items.push({
            ruleId: s.metricId,
            kind: 'metric',
            title: s.title,
            level: s.level,
            reason: s.reason,
            recommendedAction: s.action ?? '',
            escalateTo: s.level === 'red' ? config.escalate_to : null,
            evidenceLevel: s.evidenceLevel,
        });
    }
    for (const r of ev.rules) {
        if (r.level !== 'yellow' && r.level !== 'red') continue;
        items.push({
            ruleId: r.ruleId,
            kind: 'rule',
            title: r.title,
            level: r.level,
            reason: r.reason,
            recommendedAction: r.action ?? '',
            escalateTo: r.level === 'red' ? config.escalate_to : null,
            evidenceLevel: r.evidenceLevel,
        });
    }
    return items;
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms));

/** The tier of every metric for one patient right now, with its reasons, data age and sensor quality. */
export async function getStatus(userId: number, now = new Date()) {
    const user = await requireUser(userId, 'patient');
    const t = now.getTime();
    const baselines = await ensureBaselines(userId, t);
    const raw = await loadRaw(userId, {
        from: new Date(t - LOOKBACK_MS),
        to: new Date(t + 1),
        logsFrom: new Date(t - LOGS_LOOKBACK_MS),
        symptomsFrom: new Date(t - SYMPTOMS_LOOKBACK_MS),
    });
    const profile = profileById(user.environmentProfile) ?? profileById(metricsConfig.default_profile)!;
    const ds = buildDataset(raw, baselines, { gravity: profile.gravity, from: t - LOOKBACK_MS });
    const ev = evaluateAll(ds, t);

    return {
        evaluatedAt: now,
        profile: { id: profile.id, label: profile.label, gravity: profile.gravity },
        disclaimer: metricsConfig.disclaimer,
        metrics: ev.statuses.map((s) => ({ ...s, measuredAt: iso(s.measuredAt) })),
        rules: ev.rules,
        alerts: alertItems(ev),
    };
}

export interface Step {
    t: number;
    items: AlertItem[];
}

/**
 * Evaluates every `stepMinutes` (on the clock, so a step is the same moment whenever it is asked
 * for) between `from` and `to`, from one fetch of the minute data. This is what alerts are made of.
 * Baselines are the current ones: history is judged against today's set point, a documented
 * simplification.
 */
export async function evaluateRange(userId: number, from: Date, to: Date, stepMinutes: number, now = new Date()): Promise<Step[]> {
    const user = await requireUser(userId, 'patient');
    const stepMs = stepMinutes * MINUTE;
    const end = Math.min(to.getTime(), now.getTime());
    const first = Math.ceil(from.getTime() / stepMs) * stepMs;
    if (first > end) return [];

    const baselines = await ensureBaselines(userId, now.getTime());
    const dataFrom = new Date(from.getTime() - LOOKBACK_MS - HOUR);
    const raw = await loadRaw(userId, {
        from: dataFrom,
        to: new Date(end + 1),
        logsFrom: new Date(from.getTime() - LOGS_LOOKBACK_MS),
        symptomsFrom: new Date(from.getTime() - SYMPTOMS_LOOKBACK_MS),
    });
    const profile = profileById(user.environmentProfile) ?? profileById(metricsConfig.default_profile)!;
    const ds = buildDataset(raw, baselines, { gravity: profile.gravity, from: dataFrom.getTime() });

    const steps: Step[] = [];
    for (let t = first; t <= end; t += stepMs) steps.push({ t, items: alertItems(evaluateAll(ds, t)) });
    return steps;
}
