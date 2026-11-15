import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../db.js';
import { requireUser } from '../users/service.js';
import type { Reading, SeriesQuery, SummaryQuery } from './schemas.js';
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
