import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../db.js';
import { HttpError } from '../../middleware/errors.js';
import { ensureBaselines } from '../metrics/baselines.js';
import { metric, metricsConfig } from '../metrics/config.js';
import { requireUser } from '../users/service.js';
import { getBuckets } from './buckets.js';
import type { Reading, SeriesQuery, SummaryQuery, TrendQuery } from './schemas.js';
import { VITALS, VITAL_TYPES, type VitalType } from './types.js';

const ident = (name: string) => Prisma.raw(`"${name}"`);

/**
 * Stores one reading and updates the user's lifetime average. The single entry point for
 * vitals data: the HTTP route and the MQTT subscriber (step 6) both call it.
 *
 * Duplicates ((user, recordedAt) already stored, e.g. an MQTT QoS 1 redelivery) are
 * skipped and do NOT change the average. The insert and the average update run in one
 * transaction, and the update is a single SQL statement computed from the row's current
 * values, so concurrent readings for the same user can't overwrite each other:
 *   avg' = avg + (value - avg) / (count + 1)
 */
export async function ingest(userId: number, { type, value, recordedAt }: Reading) {
    await requireUser(userId, 'patient');
    const v = VITALS[type];
    const at = recordedAt ?? new Date();

    const stored = await prisma.$transaction(async (tx) => {
        const inserted = await tx.$queryRaw<{ id: number }[]>`
            INSERT INTO ${ident(v.table)} ("user_id", ${ident(v.column)}, "recorded_at")
            VALUES (${userId}, ${value}, ${at})
            ON CONFLICT ("user_id", "recorded_at") DO NOTHING
            RETURNING "id"`;
        if (inserted.length === 0) return false;

        await tx.$executeRaw`
            UPDATE "users"
            SET ${ident(v.avg)} = COALESCE(${ident(v.avg)}, 0) + (${value} - COALESCE(${ident(v.avg)}, 0)) / (${ident(v.count)} + 1),
                ${ident(v.count)} = ${ident(v.count)} + 1
            WHERE "id" = ${userId}`;
        return true;
    });

    return { type, value, recordedAt: at, stored };
}

// Time series for charts: the most recent `limit` readings in the range, oldest first.
export async function getSeries(userId: number, { type, from, to, limit }: SeriesQuery) {
    await requireUser(userId);
    const v = VITALS[type];
    const rows = await prisma.$queryRaw<{ recordedAt: Date; value: number }[]>`
        SELECT "recorded_at" AS "recordedAt", ${ident(v.column)} AS "value"
        FROM ${ident(v.table)}
        WHERE "user_id" = ${userId}
          AND (${from ?? null}::timestamptz IS NULL OR "recorded_at" >= ${from ?? null}::timestamptz)
          AND (${to ?? null}::timestamptz IS NULL OR "recorded_at" <= ${to ?? null}::timestamptz)
        ORDER BY "recorded_at" DESC
        LIMIT ${limit}`;
    return { type, unit: v.unit, readings: rows.reverse() };
}

export async function getLatest(userId: number) {
    await requireUser(userId);
    const entries = await Promise.all(
        VITAL_TYPES.map(async (type) => {
            const v = VITALS[type];
            const rows = await prisma.$queryRaw<{ recordedAt: Date; value: number }[]>`
                SELECT "recorded_at" AS "recordedAt", ${ident(v.column)} AS "value"
                FROM ${ident(v.table)}
                WHERE "user_id" = ${userId}
                ORDER BY "recorded_at" DESC
                LIMIT 1`;
            return [type, rows[0] ? { ...rows[0], unit: v.unit } : null] as const;
        }),
    );
    return Object.fromEntries(entries) as Record<VitalType, { recordedAt: Date; value: number; unit: string } | null>;
}

// Count / average / min / max per vital over an optional time range.
export async function getSummary(userId: number, { from, to }: SummaryQuery) {
    await requireUser(userId);
    const entries = await Promise.all(
        VITAL_TYPES.map(async (type) => {
            const v = VITALS[type];
            const [row] = await prisma.$queryRaw<
                { count: bigint; avg: number | null; min: number | null; max: number | null }[]
            >`
                SELECT COUNT(*) AS "count", AVG(${ident(v.column)}) AS "avg",
                       MIN(${ident(v.column)}) AS "min", MAX(${ident(v.column)}) AS "max"
                FROM ${ident(v.table)}
                WHERE "user_id" = ${userId}
                  AND (${from ?? null}::timestamptz IS NULL OR "recorded_at" >= ${from ?? null}::timestamptz)
                  AND (${to ?? null}::timestamptz IS NULL OR "recorded_at" <= ${to ?? null}::timestamptz)`;
            return [type, { unit: v.unit, count: Number(row.count), avg: row.avg, min: row.min, max: row.max }] as const;
        }),
    );
    return Object.fromEntries(entries);
}

const DAY_MS = 24 * 3600_000;
const MAX_TREND_RANGE_MS = 31 * DAY_MS;

/**
 * The band that is "normal for this person" around each bucket of a trend: the resting heart
 * rate within 10% of the baseline, the skin temperature within 0.5 °C of the person's own curve
 * for that hour. Blood oxygen has absolute limits only, so it has no band.
 */
async function baselineBand(userId: number, type: VitalType, times: Date[]) {
    if (type === 'bo' || times.length === 0) return null;
    const b = await ensureBaselines(userId);
    if (type === 'hr') {
        if (!b.hr) return null;
        const pct = metric('hr_resting').params.green_band_pct / 100;
        return times.map((t) => ({ t, low: b.hr!.median * (1 - pct), high: b.hr!.median * (1 + pct) }));
    }
    if (!b.temp) return null;
    const delta = metric('skin_temp').params.yellow_delta_c;
    const points = times.flatMap((t) => {
        const usual = b.temp!.byHour[t.getUTCHours()];
        return usual === null ? [] : [{ t, low: usual - delta, high: usual + delta }];
    });
    return points.length > 0 ? points : null;
}

/**
 * A readable trend over any range: bucketed averages (see buckets.ts), the vital's reference
 * limit from config/metrics.json and, where the person has one, their baseline band. The bucket
 * length is chosen so about `points` buckets cover the range, and is never shorter than a
 * minute. Defaults to the last 24 hours.
 */
export async function getTrend(userId: number, { type, from, to, points }: TrendQuery) {
    await requireUser(userId);
    const end = to ?? new Date();
    const start = from ?? new Date(end.getTime() - DAY_MS);
    if (end.getTime() - start.getTime() > MAX_TREND_RANGE_MS) {
        throw new HttpError(400, 'The range can be at most 31 days');
    }
    const bucketSeconds = Math.max(60, Math.ceil((end.getTime() - start.getTime()) / 1000 / points / 60) * 60);
    // `to` is inclusive for the other endpoints, so include the final instant here as well.
    const buckets = await getBuckets(userId, type, start, new Date(end.getTime() + 1), bucketSeconds);
    return {
        type,
        unit: VITALS[type].unit,
        from: start,
        to: end,
        bucketSeconds,
        /** Dashed reference line, or null where a single absolute limit would mislead (skin temperature). */
        threshold: metricsConfig.chart_limits[type],
        baseline: await baselineBand(userId, type, buckets.map((b) => b.t)),
        points: buckets.map(({ t, avg, min, max }) => ({ t, avg, min, max })),
    };
}
