import { prisma } from '../../db.js';
import { HttpError } from '../../middleware/errors.js';
import type { LogEntry } from '../../generated/prisma/client.js';
import { metricsConfig, profileById } from '../metrics/config.js';
import { requireUser } from '../users/service.js';
import type { BpValue, CreateLogBody, ListLogsQuery } from './schemas.js';

const mapOf = (sbp: number, dbp: number) => Math.round(((2 * dbp + sbp) / 3) * 10) / 10;

// What a client gets back. Blood pressure also carries its mean arterial pressure, which is
// worked out here so the clients do not each have their own formula.
function present(row: LogEntry) {
    const base = { id: row.id, kind: row.kind, recordedAt: row.recordedAt, value: row.value, createdAt: row.createdAt };
    if (row.kind !== 'bp') return base;
    const v = row.value as unknown as BpValue;
    return { ...base, derived: { map: mapOf(v.systolic, v.diastolic) } };
}

/** Stores one manual entry for a patient (modules/logs/schemas.ts says what each kind holds). */
export async function createLog(userId: number, body: CreateLogBody) {
    const user = await requireUser(userId, 'patient');
    if (body.kind === 'orthostatic' && !(profileById(user.environmentProfile)?.gravity ?? false)) {
        const profile = profileById(user.environmentProfile) ?? profileById(metricsConfig.default_profile)!;
        throw new HttpError(400, `The orthostatic check is only for environments with gravity; yours is "${profile.label}"`);
    }
    const recordedAt = body.kind === 'sleep' ? body.value.wakeTime : (body.recordedAt ?? new Date());
    // Dates inside the value (a night's bedtime and wake time) are stored as ISO strings.
    const value = JSON.parse(JSON.stringify(body.value));
    return present(await prisma.logEntry.create({ data: { userId, kind: body.kind, recordedAt, value } }));
}

/** A patient's entries, newest first. */
export async function listLogs(userId: number, { kind, from, to, limit, offset }: ListLogsQuery) {
    await requireUser(userId);
    const rows = await prisma.logEntry.findMany({
        where: { userId, kind, recordedAt: { gte: from, lte: to } },
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
    });
    return rows.map(present);
}
