import { prisma } from '../../db.js';
import { getBuckets } from '../vitals/buckets.js';
import { MINUTE, type MinutePoint, type MotionMinute } from './types.js';
import type { RawData } from './dataset.js';

// The database side of the engine: a few queries that turn what the band and the person logged
// into plain arrays. Everything is cut into one-minute pieces so a week costs about as much as a
// day of readings did one at a time, and the evaluators never touch the database.

/** One-minute averages of a vital (heart rate, skin temperature) over `[from, to)`. */
export async function minuteMeans(userId: number, type: 'hr' | 'bt', from: Date, to: Date): Promise<MinutePoint[]> {
    const buckets = await getBuckets(userId, type, from, to, 60);
    return buckets.map((b) => ({ t: b.t.getTime(), value: b.avg }));
}

/**
 * One-minute medians of blood oxygen. A median, not an average: the cuff sends about one reading a
 * second, and a few bad seconds (a moved finger) must not drag a minute down.
 */
export async function minuteMediansSpo2(userId: number, from: Date, to: Date): Promise<MinutePoint[]> {
    const rows = await prisma.$queryRaw<{ t: Date; value: number }[]>`
        SELECT date_bin(make_interval(secs => 60::double precision), "recorded_at", TIMESTAMPTZ '2001-01-01 00:00:00+00') AS "t",
               percentile_cont(0.5) WITHIN GROUP (ORDER BY "blood_o")::float8 AS "value"
        FROM "blood_oxygens"
        WHERE "user_id" = ${userId} AND "recorded_at" >= ${from} AND "recorded_at" < ${to}
        GROUP BY 1
        ORDER BY 1`;
    return rows.map((r) => ({ t: r.t.getTime(), value: r.value }));
}

/**
 * Per minute: how many seconds the wrist band tracked, how many of them were still (band 0) and
 * how many had movement (band 1-3). The band sends windows of ten seconds with one band per second
 * (-1 = not tracked), see modules/fitness.
 */
export async function motionMinutes(userId: number, from: Date, to: Date): Promise<MotionMinute[]> {
    const rows = await prisma.$queryRaw<{ t: Date; tracked: bigint; quiet: bigint; active: bigint }[]>`
        SELECT date_bin(make_interval(secs => 60::double precision),
                        fw."recorded_at" + make_interval(secs => (s.i - 1)::double precision),
                        TIMESTAMPTZ '2001-01-01 00:00:00+00') AS "t",
               COUNT(*) FILTER (WHERE s.b >= 0) AS "tracked",
               COUNT(*) FILTER (WHERE s.b = 0) AS "quiet",
               COUNT(*) FILTER (WHERE s.b > 0) AS "active"
        FROM "fitness_windows" fw
        CROSS JOIN LATERAL unnest(fw."bands") WITH ORDINALITY AS s(b, i)
        WHERE fw."user_id" = ${userId}
          AND fw."recorded_at" >= ${new Date(from.getTime() - 10_000)} AND fw."recorded_at" < ${to}
        GROUP BY 1
        ORDER BY 1`;
    return rows
        .map((r) => ({ t: r.t.getTime(), tracked: Number(r.tracked), quiet: Number(r.quiet), active: Number(r.active) }))
        .filter((m) => m.t >= from.getTime() && m.t < to.getTime());
}

/** Everything the evaluators need for the time `[from, to)`, plus longer look-backs for the logs. */
export async function loadRaw(
    userId: number,
    range: { from: Date; to: Date; logsFrom: Date; symptomsFrom: Date },
): Promise<RawData> {
    const { from, to } = range;
    const [hr, temp, spo2, motion, logs, symptoms] = await Promise.all([
        minuteMeans(userId, 'hr', from, to),
        minuteMeans(userId, 'bt', from, to),
        minuteMediansSpo2(userId, from, to),
        motionMinutes(userId, from, to),
        prisma.logEntry.findMany({
            where: { userId, recordedAt: { gte: range.logsFrom, lt: new Date(to.getTime() + 1) } },
            orderBy: { recordedAt: 'asc' },
        }),
        prisma.symptom.findMany({
            where: { userId, loggedAt: { gte: range.symptomsFrom, lt: new Date(to.getTime() + 1) } },
            select: { name: true, intensity: true, loggedAt: true },
            orderBy: { loggedAt: 'asc' },
        }),
    ]);
    return {
        hr,
        temp,
        spo2,
        motion,
        logs: logs.map((l) => ({ kind: l.kind, at: l.recordedAt.getTime(), value: l.value })),
        symptoms: symptoms.map((s) => ({ name: s.name, intensity: s.intensity, at: s.loggedAt.getTime() })),
    };
}

export const alignToMinute = (ms: number) => Math.floor(ms / MINUTE) * MINUTE;
