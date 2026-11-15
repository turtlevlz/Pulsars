import { prisma } from '../../db.js';
import { HttpError } from '../../middleware/errors.js';
import { requireUser } from '../users/service.js';
import { getBuckets } from '../vitals/buckets.js';
import { THRESHOLDS } from '../vitals/thresholds.js';
import { VITALS, VITAL_TYPES, type VitalType } from '../vitals/types.js';
import { BUCKET_SECONDS, findEpisodes, type Episode } from './episodes.js';
import type { AcknowledgeBody, AlertsQuery } from './schemas.js';

const DAY_MS = 24 * 3600_000;
export const DEFAULT_RANGE_MS = 7 * DAY_MS;
const MAX_RANGE_MS = 31 * DAY_MS;

export interface Alert extends Episode {
    type: VitalType;
    unit: string;
    threshold: (typeof THRESHOLDS)[VitalType];
    status: 'open' | 'acknowledged';
    acknowledgedAt: Date | null;
    acknowledgedBy: { id: number; name: string } | null;
}

/** Every threshold episode of a patient in a range, newest first, with who acknowledged each. */
export async function listAlerts(userId: number, { from, to, status }: AlertsQuery, now = new Date()): Promise<Alert[]> {
    await requireUser(userId, 'patient');
    const end = to ?? now;
    const start = from ?? new Date(end.getTime() - DEFAULT_RANGE_MS);
    if (end.getTime() - start.getTime() > MAX_RANGE_MS) throw new HttpError(400, 'The range can be at most 31 days');

    const found = await Promise.all(
        VITAL_TYPES.map(async (type) => {
            const buckets = await getBuckets(userId, type, start, new Date(end.getTime() + 1), BUCKET_SECONDS);
            return findEpisodes(buckets, THRESHOLDS[type], now).map((episode) => ({ type, episode }));
        }),
    );
    const episodes = found.flat();
    if (episodes.length === 0) return [];

    const acks = await prisma.alertAcknowledgement.findMany({
        where: { userId, startedAt: { gte: start, lte: end } },
        include: { acknowledger: { select: { id: true, name: true } } },
    });
    const ackFor = new Map(acks.map((a) => [`${a.type}|${a.startedAt.getTime()}`, a]));

    const alerts = episodes.map(({ type, episode }): Alert => {
        const ack = ackFor.get(`${type}|${episode.startedAt.getTime()}`);
        return {
            ...episode,
            type,
            unit: VITALS[type].unit,
            threshold: THRESHOLDS[type],
            status: ack ? 'acknowledged' : 'open',
            acknowledgedAt: ack?.acknowledgedAt ?? null,
            acknowledgedBy: ack?.acknowledger ?? null,
        };
    });
    return alerts
        .filter((a) => status === 'all' || a.status === 'open')
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

/**
 * Marks one episode as seen by a medic. The episode has to exist (it is recomputed, so a made-up
 * start time is a 404), and acknowledging twice is harmless. The first acknowledgement stays on
 * record, whoever repeats it.
 */
export async function acknowledge(userId: number, medicId: number, { type, startedAt }: AcknowledgeBody): Promise<Alert> {
    const now = new Date();
    // Look from one minute earlier, so a minute in the middle of an episode is not mistaken for
    // the start of a shorter one: the earlier minute joins the run and moves its start back.
    const from = new Date(startedAt.getTime() - BUCKET_SECONDS * 1000);
    const find = async () =>
        (await listAlerts(userId, { from, to: now, status: 'all' }, now)).find(
            (a) => a.type === type && a.startedAt.getTime() === startedAt.getTime(),
        );

    if (!(await find())) throw new HttpError(404, 'No such alert');
    await prisma.alertAcknowledgement.upsert({
        where: { userId_type_startedAt: { userId, type, startedAt } },
        create: { userId, type, startedAt, acknowledgedBy: medicId },
        update: {},
    });
    return (await find())!;
}

/** How many alerts a patient has that nobody has acknowledged yet, over the default range. */
export async function countOpenAlerts(userId: number, now = new Date()): Promise<number> {
    return (await listAlerts(userId, { status: 'open' }, now)).length;
}
