import type { BpValue, Posture } from '../logs/schemas.js';
import { metricsConfig, type MetricConfig, type MetricOf } from './config.js';
import { evaluateRules } from './rules.js';
import { isHeartSymptom, isRedFlag, logSymptomEffect, logSymptomLabel, symptomLabel } from './symptoms.js';
import {
    DAY,
    HOUR,
    MINUTE,
    type Dataset,
    type Evaluation,
    type Level,
    type Logged,
    type MetricStatus,
    type MinutePoint,
} from './types.js';

// Every evaluator here is a pure function of a Dataset and a moment: no database, no clock. The
// order is the spec's (docs/astronaut-health-metrics-spec.md, section 6): red conditions first,
// then yellow, else green, and anything that is old or missing is gray, never silently green.
// The thresholds are all read from config/metrics.json (`cfg.params`), none are written here.

// ------------------------------------------------------------------ small helpers

const round = (n: number, digits = 0) => {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Start of the last minute that is completely over; a minute that is still filling is never used. */
export const lastCompleteMinute = (now: number) => Math.floor(now / MINUTE) * MINUTE - MINUTE;

/** Index of the first element with `t > limit` (the array is sorted by `t`). */
function firstAfter(arr: { t: number }[], limit: number): number {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid].t > limit) hi = mid;
        else lo = mid + 1;
    }
    return lo;
}

function between<T extends { t: number }>(arr: T[], from: number, to: number): T[] {
    return arr.slice(firstAfter(arr, from - 1), firstAfter(arr, to));
}

function latestOf<T extends { at: number }>(arr: T[], now: number): T | undefined {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid].at > now) hi = mid;
        else lo = mid + 1;
    }
    return arr[lo - 1];
}

const fmtAge = (minutes: number) => {
    if (minutes < 90) return `${Math.round(minutes)} min ago`;
    if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
    return `${Math.round(minutes / 1440)} days ago`;
};
const fmtSpan = (ms: number) => {
    const h = ms / HOUR;
    return h < 1.5 ? `${Math.max(1, Math.round(ms / MINUTE))} minutes` : h < 48 ? `${Math.round(h)} hours` : `${Math.round(h / 24)} days`;
};

interface Core {
    level: Level;
    reason: string;
    value?: number | null;
    display?: string | null;
    measuredAt?: number | null;
    baseline?: MetricStatus['baseline'];
    quality?: Partial<MetricStatus['quality']>;
    flags?: string[];
    detail?: Record<string, unknown> | null;
}

function finish(cfg: MetricConfig, now: number, core: Core): MetricStatus {
    const measuredAt = core.measuredAt ?? null;
    return {
        metricId: cfg.metric_id,
        title: cfg.title,
        level: core.level,
        reason: core.reason,
        value: core.value ?? null,
        display: core.display ?? null,
        unit: cfg.unit,
        measuredAt,
        ageMinutes: measuredAt === null ? null : Math.max(0, Math.round((now - measuredAt) / MINUTE)),
        baseline: core.baseline ?? null,
        quality: { motionArtifact: null, coverage: null, note: null, ...core.quality },
        flags: core.flags ?? [],
        evidenceLevel: cfg.evidence_level,
        action: core.level === 'yellow' || core.level === 'red' ? cfg.action[core.level] : null,
        detail: core.detail ?? null,
    };
}

/** Consecutive minutes (one minute apart) ending at the newest of `points`. */
function lastRun(points: MinutePoint[]): MinutePoint[] {
    let start = points.length;
    for (let i = points.length - 1; i >= 0; i--) {
        if (i < points.length - 1 && points[i + 1].t - points[i].t !== MINUTE) break;
        start = i;
    }
    return points.slice(start);
}

const lastN = <T>(xs: T[], n: number): T[] | null => (xs.length >= n ? xs.slice(xs.length - n) : null);

// ------------------------------------------------------------------ resting heart rate

export function evalHrResting(ds: Dataset, cfg: MetricOf<'hr_resting'>, now: number): MetricStatus {
    const p = cfg.params;
    const end = lastCompleteMinute(now);
    const gray = (reason: string, extra: Partial<Core> = {}) => finish(cfg, now, { level: 'gray', reason, ...extra });

    const latest = ds.hr[firstAfter(ds.hr, end) - 1];
    if (!latest) return gray(`No heart-rate readings in the last ${fmtSpan(now - ds.from)}.`);
    const sinceLatest = (now - (latest.t + MINUTE)) / MINUTE;
    if (sinceLatest > cfg.stale_after_minutes) {
        return gray(`No heart-rate data for ${fmtAge(sinceLatest).replace(' ago', '')}.`, { measuredAt: latest.t + MINUTE });
    }

    const recent = between(ds.hr, end - (p.lookback_minutes - 1) * MINUTE, end);
    const resting = recent.filter((m) => ds.resting.has(m.t));
    if (resting.length === 0) {
        const haveMotion = recent.some((m) => ds.motion.has(m.t));
        return gray(
            haveMotion
                ? `No resting minutes in the last ${fmtSpan(p.lookback_minutes * MINUTE)}: the band has not seen you still for ${p.rest_run_minutes} minutes in a row.`
                : 'The band has sent no motion data, so it cannot tell when you are at rest.',
            { measuredAt: latest.t + MINUTE, quality: { motionArtifact: null, coverage: null, note: haveMotion ? null : 'no motion data' } },
        );
    }

    const run = lastRun(resting);
    const lastRest = run[run.length - 1];
    const measuredAt = lastRest.t + MINUTE;
    if (now - measuredAt > p.rest_hold_minutes * MINUTE) {
        return gray(`No resting heart rate in the last ${fmtSpan(p.rest_hold_minutes * MINUTE)} (last one ${fmtAge((now - measuredAt) / MINUTE)}).`, { measuredAt });
    }
    if (run.length < p.min_resting_minutes) {
        return gray('Building a resting reading: you have only just been still.', { measuredAt });
    }

    const value = mean(run.slice(-5).map((m) => m.value));
    const base = ds.baselines.hr?.median ?? null;
    const band = p.green_band_pct / 100;
    const above = base !== null && value > base * (1 + band);
    const below = base !== null && value < base * (1 - band);
    const out = value > p.green_max || value < p.green_min || above || below;
    const flags = [...(value > p.green_max || above ? ['elevated'] : []), ...(value < p.green_min || below ? ['low'] : [])];
    const baseline = { value: base === null ? null : round(base, 1), label: base === null ? 'not established yet' : `${round(base)} bpm (7-day resting median)` };
    const recentMinutes = between(ds.hr, end - 9 * MINUTE, end).length;
    const common = {
        value: round(value, 1),
        display: `${round(value)} bpm`,
        measuredAt,
        baseline,
        flags,
        quality: { motionArtifact: false, coverage: recentMinutes / 10, note: base === null ? 'baseline not established' : null },
        detail: { restingMinutesInRow: run.length },
    };
    const v = `${round(value)} bpm`;

    // red
    const redRun = lastN(run, p.red_sustained_minutes);
    if (redRun && (redRun.every((m) => m.value > p.red_high) || redRun.every((m) => m.value < p.red_low))) {
        return finish(cfg, now, {
            ...common,
            level: 'red',
            reason: `Resting heart rate ${v} for ${p.red_sustained_minutes} minutes or more, ${value > p.red_high ? `above ${p.red_high}` : `below ${p.red_low}`}.`,
        });
    }
    const symptom = ds.symptoms.find(
        (s) => isHeartSymptom(s.id) && s.at <= now && now - s.at <= p.symptom_window_minutes * MINUTE,
    );
    if (out && symptom) {
        return finish(cfg, now, {
            ...common,
            level: 'red',
            reason: `Resting heart rate ${v} is outside your usual range, and you logged ${symptomLabel(symptom.id!).toLowerCase()} ${fmtAge((now - symptom.at) / MINUTE)}.`,
        });
    }

    // yellow
    const absolute = lastN(run, p.absolute_sustained_minutes);
    if (absolute && (absolute.every((m) => m.value > p.green_max) || absolute.every((m) => m.value < p.green_min))) {
        return finish(cfg, now, {
            ...common,
            level: 'yellow',
            reason: `Resting heart rate ${v} has been ${value > p.green_max ? `above ${p.green_max}` : `below ${p.green_min}`} for ${p.absolute_sustained_minutes} minutes or more.`,
        });
    }
    const sustained = base === null ? null : lastN(run, p.yellow_sustained_minutes);
    if (base !== null && sustained && (sustained.every((m) => m.value > base * (1 + band)) || sustained.every((m) => m.value < base * (1 - band)))) {
        return finish(cfg, now, {
            ...common,
            level: 'yellow',
            reason: `Resting heart rate ${v} has been more than ${p.green_band_pct}% ${value > base ? 'above' : 'below'} your usual ${round(base)} bpm for ${p.yellow_sustained_minutes} resting minutes.`,
        });
    }

    // green
    if (out) {
        return finish(cfg, now, {
            ...common,
            level: 'green',
            reason: `Resting heart rate ${v} is outside your usual range, but has not lasted long enough (${Math.min(run.length, p.yellow_sustained_minutes)} of ${p.yellow_sustained_minutes} resting minutes) to raise a flag.`,
        });
    }
    return finish(cfg, now, {
        ...common,
        level: 'green',
        reason:
            base === null
                ? `Resting heart rate ${v} is within ${p.green_min}-${p.green_max} bpm. Your own baseline is not established yet.`
                : `Resting heart rate ${v} is within ${p.green_band_pct}% of your usual ${round(base)} bpm.`,
    });
}

// ------------------------------------------------------------------ skin temperature

const hourOf = (t: number) => new Date(t).getUTCHours();

export function evalSkinTemp(ds: Dataset, cfg: MetricOf<'skin_temp'>, now: number): MetricStatus {
    const p = cfg.params;
    const end = lastCompleteMinute(now);
    const core = latestOf(ds.coreTemp, now);
    const coreFresh = core !== undefined && now - core.at <= p.core_fresh_hours * HOUR;

    // The one way to red: a temperature the person measured and logged themselves.
    if (core && coreFresh && core.value.celsius >= p.core_red_c) {
        return finish(cfg, now, {
            level: 'red',
            reason: `You logged a ${core.value.site} temperature of ${core.value.celsius} °C, which is ${p.core_red_c} °C or higher.`,
            value: core.value.celsius,
            display: `${core.value.celsius} °C (${core.value.site})`,
            measuredAt: core.at,
            flags: ['core_fever'],
            detail: { source: 'logged core/oral temperature' },
        });
    }

    const gray = (reason: string, extra: Partial<Core> = {}) => finish(cfg, now, { level: 'gray', reason, ...extra });
    const latest = ds.temp[firstAfter(ds.temp, end) - 1];
    if (!latest) return gray(`No skin-temperature readings in the last ${fmtSpan(now - ds.from)}.`);
    const sinceLatest = (now - (latest.t + MINUTE)) / MINUTE;
    if (sinceLatest > cfg.stale_after_minutes) {
        return gray(`No skin-temperature data for ${fmtAge(sinceLatest).replace(' ago', '')}.`, { measuredAt: latest.t + MINUTE });
    }
    const curve = ds.baselines.temp;
    if (!curve) {
        return gray(`Your skin-temperature baseline is not established yet: it needs about ${p.baseline_min_days} days of your own data.`, {
            measuredAt: latest.t + MINUTE,
            quality: { motionArtifact: null, coverage: null, note: 'baseline not established' },
        });
    }

    const window = between(ds.temp, end - (p.sustained_minutes - 1) * MINUTE, end);
    const deltas = window.flatMap((m) => {
        const b = curve.byHour[hourOf(m.t)];
        return b === null || b === undefined ? [] : [m.value - b];
    });
    const usual = curve.byHour[hourOf(latest.t)];
    const value = mean(window.slice(-5).map((m) => m.value));
    const common = {
        value: round(value, 2),
        display: `${round(value, 1)} °C`,
        measuredAt: latest.t + MINUTE,
        baseline: { value: usual === null || usual === undefined ? null : round(usual, 2), label: usual == null ? 'unknown for this hour' : `${round(usual, 1)} °C usual at this hour (UTC)` },
        quality: { motionArtifact: null, coverage: window.length / p.sustained_minutes, note: 'wrist skin temperature, not core' },
    };
    if (deltas.length < p.min_minutes_with_data) {
        return gray(`Not enough recent skin-temperature data to compare (${deltas.length} of ${p.min_minutes_with_data} minutes).`, common);
    }
    const delta = median(deltas);
    if (delta >= p.yellow_delta_c) {
        const checked = core && coreFresh ? ` Your logged ${core.value.site} temperature was ${core.value.celsius} °C.` : '';
        return finish(cfg, now, {
            ...common,
            level: 'yellow',
            flags: ['rise'],
            detail: { deltaC: round(delta, 2) },
            reason: `Skin temperature has been about ${round(delta, 1)} °C above your usual for this time of day for ${p.sustained_minutes} minutes. The band alone cannot confirm a fever: check with a thermometer.${checked}`,
        });
    }
    return finish(cfg, now, {
        ...common,
        level: 'green',
        detail: { deltaC: round(delta, 2) },
        reason: `Skin temperature is within ${p.yellow_delta_c} °C of your usual for this time of day.`,
    });
}

// ------------------------------------------------------------------ SpO2

export function evalSpo2(ds: Dataset, cfg: MetricOf<'spo2'>, now: number): MetricStatus {
    const p = cfg.params;
    const end = lastCompleteMinute(now);
    const gray = (reason: string, extra: Partial<Core> = {}) => finish(cfg, now, { level: 'gray', reason, ...extra });

    const latestAny = ds.spo2[firstAfter(ds.spo2, end) - 1];
    if (!latestAny) return gray(`No blood-oxygen readings in the last ${fmtSpan(now - ds.from)}.`);
    const sinceLatest = (now - (latestAny.t + MINUTE)) / MINUTE;
    if (sinceLatest > cfg.stale_after_minutes) {
        return gray(`No blood-oxygen data for ${fmtAge(sinceLatest).replace(' ago', '')}.`, { measuredAt: latestAny.t + MINUTE });
    }

    const recent = between(ds.spo2, end - (p.lookback_minutes - 1) * MINUTE, end);
    // A minute with motion is skipped: it neither counts towards a flag nor against one.
    const usable = recent.filter((m) => ds.motion.get(m.t) !== 'active');
    if (usable.length === 0) {
        return gray(`Every blood-oxygen minute in the last ${fmtSpan(p.lookback_minutes * MINUTE)} had arm or hand motion, so none were used.`, {
            measuredAt: latestAny.t + MINUTE,
            quality: { motionArtifact: true, coverage: 0, note: null },
        });
    }
    const last = usable[usable.length - 1];
    const common = {
        value: round(last.value, 1),
        display: `${round(last.value)} %`,
        measuredAt: last.t + MINUTE,
        quality: {
            motionArtifact: ds.motion.get(latestAny.t) === 'active',
            coverage: usable.length / p.lookback_minutes,
            note: ds.motion.size === 0 ? 'no motion data: readings with motion cannot be skipped' : null,
        },
        detail: { usableMinutes: usable.length, skippedForMotion: recent.length - usable.length },
    };

    const redRun = lastN(usable, p.red_consecutive_minutes);
    if (redRun && redRun.every((m) => m.value < p.yellow_min)) {
        return finish(cfg, now, {
            ...common,
            level: 'red',
            reason: `Blood oxygen has been below ${p.yellow_min}% for ${p.red_consecutive_minutes} one-minute medians in a row (latest ${round(last.value)}%).`,
        });
    }
    const yellowRun = lastN(usable, p.yellow_consecutive_minutes);
    if (yellowRun && yellowRun.every((m) => m.value < p.green_min)) {
        return finish(cfg, now, {
            ...common,
            level: 'yellow',
            reason: `Blood oxygen is ${round(last.value)}%, below ${p.green_min}% for ${p.yellow_consecutive_minutes} minutes in a row. Retest at rest and check the sensor fit.`,
        });
    }
    if (usable.length < p.yellow_consecutive_minutes && last.value < p.green_min) {
        return finish(cfg, now, {
            ...common,
            level: 'gray',
            reason: `One blood-oxygen minute at ${round(last.value)}%, below ${p.green_min}%: not enough usable data to judge. Hold still and retest.`,
        });
    }
    return finish(cfg, now, {
        ...common,
        level: 'green',
        reason: `Blood oxygen is ${round(last.value)}% (minute median), ${last.value >= p.green_min ? `at or above ${p.green_min}%` : 'a single low minute, not repeated'}.`,
    });
}

// ------------------------------------------------------------------ blood pressure

interface BpBaseline {
    sbp: number;
    dbp: number;
    n: number;
}

/** The person's usual pressure in one posture: the median of their earlier logs. Needs a few logs first. */
export function bpBaseline(
    logs: Logged<BpValue>[],
    posture: Posture,
    before: number,
    p: { baseline_days: number; baseline_min_logs: number },
): BpBaseline | null {
    const earlier = logs.filter((l) => l.value.posture === posture && l.at < before && before - l.at <= p.baseline_days * DAY);
    if (earlier.length < p.baseline_min_logs) return null;
    return {
        sbp: median(earlier.map((l) => l.value.systolic)),
        dbp: median(earlier.map((l) => l.value.diastolic)),
        n: earlier.length,
    };
}

const mapOf = (sbp: number, dbp: number) => (2 * dbp + sbp) / 3;

export function evalBp(ds: Dataset, cfg: MetricOf<'bp'>, now: number): MetricStatus {
    const p = cfg.params;
    const latest = latestOf(ds.bp, now);
    if (!latest) return finish(cfg, now, { level: 'gray', reason: 'No blood pressure has been logged yet.' });

    const v = latest.value;
    const map = round(mapOf(v.systolic, v.diastolic), 1);
    const display = `${v.systolic}/${v.diastolic} mmHg, MAP ${map}`;
    const ageMinutes = (now - latest.at) / MINUTE;
    const base = bpBaseline(ds.bp, v.posture, latest.at, p);
    const common = {
        value: v.systolic,
        display,
        measuredAt: latest.at,
        baseline: { value: base ? base.sbp : null, label: base ? `${round(base.sbp)}/${round(base.dbp)} usual (${v.posture})` : `not established yet (${v.posture})` },
        quality: {
            motionArtifact: null,
            coverage: null,
            note: v.restedFiveMinutes && v.armAtHeartLevel ? null : 'technique not confirmed',
        },
        detail: { systolic: v.systolic, diastolic: v.diastolic, heartRate: v.heartRate, posture: v.posture, map, symptoms: v.symptoms },
    };
    if (ageMinutes > cfg.stale_after_minutes) {
        return finish(cfg, now, { ...common, level: 'gray', reason: `Your last blood pressure (${display}) was logged ${fmtAge(ageMinutes)}. Log a new one.` });
    }

    const earlier = ds.bp.filter((l) => l.at < latest.at && latest.at - l.at <= p.repeat_within_hours * HOUR);
    const prev = earlier[earlier.length - 1]?.value;
    const confirmed = v.restedFiveMinutes && v.armAtHeartLevel;
    const severe = v.systolic >= p.high_red_sbp || v.diastolic >= p.high_red_dbp;
    const high = v.systolic >= p.repeat_high_sbp || v.diastolic >= p.repeat_high_dbp;
    const prevHigh = prev !== undefined && (prev.systolic >= p.repeat_high_sbp || prev.diastolic >= p.repeat_high_dbp);
    const lowEnd = v.systolic < p.low_sbp || v.diastolic < p.low_dbp;
    const lowMap = map < p.low_map;
    const prevLowMap = prev !== undefined && mapOf(prev.systolic, prev.diastolic) < p.low_map;
    const redSymptoms = v.symptoms.filter((s) => logSymptomEffect(s) === 'red');
    const presyncope = v.symptoms.filter((s) => logSymptomEffect(s) === 'presyncope');
    const labels = (ids: string[]) => ids.map((s) => logSymptomLabel(s).toLowerCase()).join(', ');

    const flags = [
        ...(lowEnd || lowMap || (base !== null && base.sbp - v.systolic >= p.below_baseline_yellow_mmhg) ? ['low'] : []),
        ...(v.systolic >= p.yellow_high_sbp || v.diastolic >= p.yellow_high_dbp ? ['high'] : []),
    ];
    const withFlags = { ...common, flags };

    // red
    if (redSymptoms.length > 0) {
        return finish(cfg, now, { ...withFlags, level: 'red', reason: `You logged ${labels(redSymptoms)} with this reading (${display}). That needs a person to look at it now.` });
    }
    if (lowEnd && presyncope.length > 0) {
        return finish(cfg, now, { ...withFlags, level: 'red', reason: `Low pressure (${display}) with ${labels(presyncope)}.` });
    }
    const numeric = severe
        ? { why: `at or above ${p.high_red_sbp}/${p.high_red_dbp}`, repeated: prevHigh }
        : high && prevHigh
          ? { why: `at or above ${p.repeat_high_sbp}/${p.repeat_high_dbp} twice in a row`, repeated: true }
          : lowMap && prevLowMap
            ? { why: `a mean arterial pressure below ${p.low_map} twice in a row`, repeated: true }
            : null;
    if (numeric) {
        // Numbers alone from a shaky technique are not enough for red, unless they were repeated.
        if (confirmed || (severe && numeric.repeated)) {
            return finish(cfg, now, { ...withFlags, level: 'red', reason: `Blood pressure ${display} is ${numeric.why}.` });
        }
        return finish(cfg, now, {
            ...withFlags,
            level: 'yellow',
            reason: `Blood pressure ${display} is ${numeric.why}, but the technique was not confirmed (5 minutes of rest, arm at heart level). Recheck properly.`,
        });
    }

    // yellow
    if (high) return finish(cfg, now, { ...withFlags, level: 'yellow', reason: `Blood pressure ${display} is ${p.repeat_high_sbp}/${p.repeat_high_dbp} or higher on this reading. Recheck after 5 minutes' rest.` });
    if (v.systolic >= p.yellow_high_sbp || v.diastolic >= p.yellow_high_dbp) {
        return finish(cfg, now, { ...withFlags, level: 'yellow', reason: `Blood pressure ${display} is in the raised range (${p.yellow_high_sbp}-${p.repeat_high_sbp - 1}/${p.yellow_high_dbp}-${p.repeat_high_dbp - 1}).` });
    }
    if (lowEnd || lowMap) {
        return finish(cfg, now, { ...withFlags, level: 'yellow', reason: `Blood pressure ${display} is low (below ${p.low_sbp}/${p.low_dbp} or a mean arterial pressure below ${p.low_map}), without symptoms.` });
    }
    if (v.symptoms.length > 0) {
        return finish(cfg, now, { ...withFlags, level: 'yellow', reason: `Blood pressure ${display} is in range, but you logged ${labels(v.symptoms)} with it.` });
    }
    if (base !== null && v.systolic - base.sbp > p.above_baseline_yellow_mmhg) {
        return finish(cfg, now, { ...withFlags, level: 'yellow', reason: `Systolic pressure ${v.systolic} is ${round(v.systolic - base.sbp)} mmHg above your usual ${round(base.sbp)} (${v.posture}).` });
    }
    if (base !== null && base.sbp - v.systolic >= p.below_baseline_yellow_mmhg) {
        return finish(cfg, now, { ...withFlags, level: 'yellow', reason: `Systolic pressure ${v.systolic} is ${round(base.sbp - v.systolic)} mmHg below your usual ${round(base.sbp)} (${v.posture}).` });
    }

    return finish(cfg, now, {
        ...withFlags,
        level: 'green',
        reason: base === null
            ? `Blood pressure ${display} is in range. Your own usual pressure is not established yet (needs ${p.baseline_min_logs} earlier logs).`
            : `Blood pressure ${display} is in range and close to your usual ${round(base.sbp)}/${round(base.dbp)}.`,
    });
}

// ------------------------------------------------------------------ sleep

export function evalSleep(ds: Dataset, cfg: MetricOf<'sleep'>, now: number): MetricStatus {
    const p = cfg.params;
    const recent = ds.sleep.filter((s) => s.at <= now && now - s.at < p.window_nights * DAY);
    const latest = latestOf(ds.sleep, now);
    if (!latest) return finish(cfg, now, { level: 'gray', reason: 'No sleep has been logged yet.' });
    const measuredAt = latest.at;
    if ((now - measuredAt) / MINUTE > cfg.stale_after_minutes) {
        return finish(cfg, now, { level: 'gray', measuredAt, reason: `Your last sleep log was ${fmtAge((now - measuredAt) / MINUTE)}. Log last night.` });
    }
    // Several entries on the same (UTC) morning, say a nap, are one night.
    const nights = new Map<string, number>();
    for (const s of recent) {
        const hours = (Date.parse(s.value.wakeTime) - Date.parse(s.value.bedtime)) / HOUR;
        const day = new Date(s.at).toISOString().slice(0, 10);
        nights.set(day, (nights.get(day) ?? 0) + hours);
    }
    if (nights.size < p.min_nights) {
        return finish(cfg, now, {
            level: 'gray',
            measuredAt,
            reason: `Only ${nights.size} of the last ${p.window_nights} nights are logged. It needs at least ${p.min_nights} to give an average.`,
        });
    }
    const avg = mean([...nights.values()]);
    const common = {
        value: round(avg, 1),
        display: `${round(avg, 1)} h average`,
        measuredAt,
        quality: { motionArtifact: null, coverage: nights.size / p.window_nights, note: 'logged by hand' },
        detail: { nights: nights.size },
    };
    const basis = `average of ${nights.size} logged nights`;
    if (avg >= p.green_hours) return finish(cfg, now, { ...common, level: 'green', reason: `You are averaging ${round(avg, 1)} hours of sleep (${basis}).` });
    if (avg >= p.yellow_hours) return finish(cfg, now, { ...common, level: 'yellow', reason: `You are averaging ${round(avg, 1)} hours of sleep (${basis}), below the ${p.green_hours} hours adults need.` });
    return finish(cfg, now, { ...common, level: 'red', reason: `You are averaging ${round(avg, 1)} hours of sleep (${basis}), below ${p.yellow_hours} hours. That is enough to slow your reactions and lower your mood.` });
}

// ------------------------------------------------------------------ orthostatic check

export function evalOrthostatic(ds: Dataset, cfg: MetricOf<'orthostatic'>, now: number): MetricStatus {
    const p = cfg.params;
    const latest = latestOf(ds.orthostatic, now);
    if (!latest) return finish(cfg, now, { level: 'gray', reason: 'No orthostatic check has been logged yet.' });
    const measuredAt = latest.at;
    if ((now - measuredAt) / MINUTE > cfg.stale_after_minutes) {
        return finish(cfg, now, { level: 'gray', measuredAt, reason: `Your last orthostatic check was ${fmtAge((now - measuredAt) / MINUTE)}.` });
    }
    const v = latest.value;
    const dropSbp = v.supine.systolic - Math.min(v.standing1.systolic, v.standing3.systolic);
    const dropDbp = v.supine.diastolic - Math.min(v.standing1.diastolic, v.standing3.diastolic);
    const meets = dropSbp >= p.sbp_drop || dropDbp >= p.dbp_drop;
    const standingHr = Math.max(v.standing1.heartRate, v.standing3.heartRate);
    const hrRise = standingHr - v.supine.heartRate;
    const flags: string[] = [];
    const notes: string[] = [];
    if (meets && hrRise < p.hr_rise_low) {
        flags.push('autonomic_pattern');
        notes.push(`The heart rate rose only ${hrRise} bpm, which can point to the body not compensating.`);
    }
    if (meets && (hrRise > p.hr_rise_high || standingHr > p.hr_high)) {
        flags.push('volume_or_pots_pattern');
        notes.push(`The heart rate rose ${hrRise} bpm to ${standingHr}, which can point to low fluid volume.`);
    }
    const fainted = v.symptoms.includes('fainting');
    const presyncope = v.symptoms.filter((s) => logSymptomEffect(s) === 'presyncope');
    const common = {
        value: dropSbp,
        display: `${dropSbp}/${dropDbp} mmHg drop`,
        measuredAt,
        flags,
        quality: { motionArtifact: null, coverage: null, note: 'logged by hand' },
        detail: { dropSystolic: dropSbp, dropDiastolic: dropDbp, heartRateRise: hrRise },
    };
    const drop = `Pressure fell ${dropSbp}/${dropDbp} mmHg on standing.`;
    const tail = notes.length > 0 ? ` ${notes.join(' ')}` : '';
    if (fainted) return finish(cfg, now, { ...common, level: 'red', reason: `You fainted during the check. ${drop}${tail}` });
    if (meets && presyncope.length > 0) {
        return finish(cfg, now, { ...common, level: 'red', reason: `${drop} You also logged ${presyncope.map((s) => logSymptomLabel(s).toLowerCase()).join(', ')}.${tail}` });
    }
    if (meets) return finish(cfg, now, { ...common, level: 'yellow', reason: `${drop} That meets the definition of orthostatic hypotension (${p.sbp_drop} systolic or ${p.dbp_drop} diastolic).${tail}` });
    if (presyncope.length > 0) {
        return finish(cfg, now, { ...common, level: 'yellow', reason: `Pressure held (${dropSbp}/${dropDbp} mmHg drop), but you logged ${presyncope.map((s) => logSymptomLabel(s).toLowerCase()).join(', ')} on standing.` });
    }
    return finish(cfg, now, { ...common, level: 'green', reason: `${drop} That is under the ${p.sbp_drop}/${p.dbp_drop} mmHg limit.` });
}

// ------------------------------------------------------------------ symptoms

export function evalSymptoms(ds: Dataset, cfg: MetricOf<'symptoms'>, now: number): MetricStatus {
    const p = cfg.params;
    const recent = ds.symptoms.filter((s) => s.at <= now && now - s.at <= p.window_hours * HOUR);
    const newest = (xs: typeof recent) => xs.reduce((a, b) => (b.at > a.at ? b : a));
    const label = (s: (typeof recent)[number]) => (s.id ? symptomLabel(s.id) : s.name);
    const flagged = recent.filter((s) => isRedFlag(s.id));
    if (flagged.length > 0) {
        const s = newest(flagged);
        return finish(cfg, now, {
            level: 'red',
            reason: `${label(s)} logged ${fmtAge((now - s.at) / MINUTE)} (severity ${s.intensity}). This is a red-flag symptom at any severity.`,
            display: label(s),
            measuredAt: s.at,
            flags: ['red_flag'],
        });
    }
    const strong = recent.filter((s) => s.intensity >= p.yellow_min_intensity);
    if (strong.length > 0) {
        const s = newest(strong);
        return finish(cfg, now, {
            level: 'yellow',
            reason: `${label(s)} logged ${fmtAge((now - s.at) / MINUTE)} at severity ${s.intensity} of 5.`,
            display: label(s),
            measuredAt: s.at,
        });
    }
    return finish(cfg, now, {
        level: 'green',
        reason: recent.length === 0 ? `No symptoms reported in the last ${p.window_hours} hours.` : `Only mild symptoms reported in the last ${p.window_hours} hours.`,
        measuredAt: recent.length > 0 ? newest(recent).at : null,
    });
}

// ------------------------------------------------------------------ everything at once

/** Every metric's tier at one moment, plus the cross rules they trigger together. */
export function evaluateAll(ds: Dataset, now: number, config = metricsConfig): Evaluation {
    const out: MetricStatus[] = [];
    for (const cfg of config.metrics) {
        switch (cfg.metric_id) {
            case 'hr_resting':
                out.push(evalHrResting(ds, cfg, now));
                break;
            case 'skin_temp':
                out.push(evalSkinTemp(ds, cfg, now));
                break;
            case 'spo2':
                out.push(evalSpo2(ds, cfg, now));
                break;
            case 'bp':
                out.push(evalBp(ds, cfg, now));
                break;
            case 'sleep':
                out.push(evalSleep(ds, cfg, now));
                break;
            case 'orthostatic':
                if (ds.gravity) out.push(evalOrthostatic(ds, cfg, now));
                break;
            case 'symptoms':
                out.push(evalSymptoms(ds, cfg, now));
                break;
        }
    }
    return { statuses: out, rules: evaluateRules(out, config) };
}

export { between, firstAfter, hourOf };
