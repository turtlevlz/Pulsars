import { prisma } from '../../db.js';
import { Prisma } from '../../generated/prisma/client.js';
import { VITALS, type VitalType } from './types.js';

const ident = (name: string) => Prisma.raw(`"${name}"`);

export interface Bucket {
    /** Start of the bucket. Buckets are aligned to the clock, so they don't shift as time passes. */
    t: Date;
    avg: number;
    min: number;
    max: number;
    count: number;
}

/**
 * Readings of one vital grouped into fixed-length time buckets (average, min, max, count) over
 * `[from, to)`. Empty buckets are left out. The cuff sends about one reading a second, so this
 * is what keeps a week or a month of data small enough to draw and to scan for alerts.
 */
export async function getBuckets(userId: number, type: VitalType, from: Date, to: Date, bucketSeconds: number): Promise<Bucket[]> {
    const v = VITALS[type];
    const rows = await prisma.$queryRaw<{ t: Date; avg: number; min: number; max: number; count: bigint }[]>`
        SELECT date_bin(make_interval(secs => ${bucketSeconds}::double precision), "recorded_at", TIMESTAMPTZ '2001-01-01 00:00:00+00') AS "t",
               AVG(${ident(v.column)})::float8 AS "avg",
               MIN(${ident(v.column)})::float8 AS "min",
               MAX(${ident(v.column)})::float8 AS "max",
               COUNT(*) AS "count"
        FROM ${ident(v.table)}
        WHERE "user_id" = ${userId} AND "recorded_at" >= ${from} AND "recorded_at" < ${to}
        GROUP BY 1
        ORDER BY 1`;
    return rows.map((r) => ({ ...r, count: Number(r.count) }));
}
