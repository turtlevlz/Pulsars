import { prisma } from '../../db.js';
import { HttpError } from '../../middleware/errors.js';
import { evaluateRange } from '../metrics/service.js';
import { MINUTE } from '../metrics/types.js';
import { groupEpisodes, MERGE_GAP_MINUTES, STEP_MINUTES, type Episode } from './episodes.js';
import type { AcknowledgeBody, AlertsQuery } from './schemas.js';

const DAY_MS = 24 * 3600_000;
export const DEFAULT_RANGE_MS = 7 * DAY_MS;
const MAX_RANGE_MS = 31 * DAY_MS;

export interface Alert extends Episode {
    status: 'open' | 'acknowledged';
    acknowledgedAt: Date | null;
    acknowledgedBy: { id: number; name: string } | null;
}

/**
 * Every alert of a patient in a range, newest first, with who acknowledged each. The alerts are
 * worked out here from the readings and logs (modules/metrics), not stored.
 */
export async function listAlerts(userId: number, { from, to, status }: AlertsQuery, now = new Date()): Promise<Alert[]> {
    const end = to ?? now;
    const start = from ?? new Date(end.getTime() - DEFAULT_RANGE_MS);
    if (end.getTime() - start.getTime() > MAX_RANGE_MS) throw new HttpError(400, 'The range can be at most 31 days');

    const episodes = groupEpisodes(await evaluateRange(userId, start, end, STEP_MINUTES, now));
    if (episodes.length === 0) return [];

    const acks = await prisma.alertAcknowledgement.findMany({
        where: { userId, startedAt: { gte: start, lte: end } },
        include: { acknowledger: { select: { id: true, name: true } } },
    });
    const ackFor = new Map(acks.map((a) => [`${a.ruleId}|${a.startedAt.getTime()}`, a]));

    const alerts = episodes.map((episode): Alert => {
        const ack = ackFor.get(`${episode.ruleId}|${episode.startedAt.getTime()}`);
        return {
            ...episode,
            status: ack ? 'acknowledged' : 'open',
            acknowledgedAt: ack?.acknowledgedAt ?? null,
            acknowledgedBy: ack?.acknowledger ?? null,
        };
    });
    return alerts
        .filter((a) => status === 'all' || a.status === 'open')
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || a.ruleId.localeCompare(b.ruleId));
}

/**
 * Marks one alert as seen by a medic. The alert has to exist (it is recomputed, so a made-up
 * start time is a 404), and acknowledging twice is harmless. The first acknowledgement stays on
 * record, whoever repeats it.
 */
export async function acknowledge(userId: number, medicId: number, { ruleId, startedAt }: AcknowledgeBody): Promise<Alert> {
    const now = new Date();
    // Start looking early enough that the steps before it are seen: if the rule was already
    // active just before, this is not the start of an alert and the lookup fails.
    const from = new Date(startedAt.getTime() - (MERGE_GAP_MINUTES + STEP_MINUTES) * MINUTE);
    const find = async () =>
        (await listAlerts(userId, { from, to: now, status: 'all' }, now)).find(
            (a) => a.ruleId === ruleId && a.startedAt.getTime() === startedAt.getTime(),
        );

    if (!(await find())) throw new HttpError(404, 'No such alert');
    await prisma.alertAcknowledgement.upsert({
        where: { userId_ruleId_startedAt: { userId, ruleId, startedAt } },
        create: { userId, ruleId, startedAt, acknowledgedBy: medicId },
        update: {},
    });
    return (await find())!;
}

/** The patient's alerts nobody has acknowledged yet over the default range, and the worst level among them. */
export async function openAlertSummary(userId: number, now = new Date()): Promise<{ count: number; topLevel: 'red' | 'yellow' | null }> {
    const open = await listAlerts(userId, { status: 'open' }, now);
    return {
        count: open.length,
        topLevel: open.some((a) => a.level === 'red') ? 'red' : open.length > 0 ? 'yellow' : null,
    };
}
