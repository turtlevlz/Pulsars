import { prisma } from '../../db.js';
import { HttpError } from '../../middleware/errors.js';
import { requireUser } from '../users/service.js';
import { activeSeconds, analyzeDay, classify, contextRadiusMs, type Intensity, type ObservedWindow } from './activity.js';
import { ROUTINES, routineTitle } from './routines.js';
import type { FitnessWindow } from './schemas.js';

const lastSlotOffset = 9000;

export async function ingestWindow(userId: number, window: FitnessWindow) {
    await requireUser(userId, 'patient');
    const { deviceId, bootId, deviceTimeMs, recordedAt, samples } = window;
    const { count } = await prisma.fitnessWindow.createMany({
        data: {
            userId, deviceId, bootId, deviceTimeMs: BigInt(deviceTimeMs), recordedAt,
            bands: classify(samples),
            context: samples.map(sample => sample ? [sample.pulse_bpm, sample.skin_temp_c] : null),
        },
        skipDuplicates: true,
    });
    return count === 1;
}

function nextDate(date: string, unit: 'day' | 'month') {
    const next = new Date(`${date}T00:00:00Z`);
    if (unit === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
    else next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
}

function localDate(now: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat('en', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value).join('-');
}

export async function getCalendar(userId: number, month: string, timeZone: string) {
    await requireUser(userId, 'patient');
    const first = `${month}-01`;
    const next = nextDate(first, 'month');
    // Restrict the scan to windows covering the month, then assign individual seconds
    // to civil dates so a window crossing midnight contributes to both days.
    const rows = await prisma.$queryRaw<Array<Intensity & { date: string; trackedSeconds: number }>>`
        WITH samples AS (
            SELECT ((w.recorded_at + (s.slot - 1) * interval '1 second') AT TIME ZONE ${timeZone})::date AS day,
                s.band
            FROM fitness_windows AS w
            CROSS JOIN LATERAL unnest(w.bands) WITH ORDINALITY AS s(band, slot)
            WHERE w.user_id = ${userId} AND s.band >= 0
                AND w.recorded_at >= (${first}::date::timestamp AT TIME ZONE ${timeZone}) - interval '1 hour 9 seconds'
                AND w.recorded_at < (${next}::date::timestamp AT TIME ZONE ${timeZone}) + interval '1 hour'
        )
        SELECT to_char(day, 'YYYY-MM-DD') AS date, count(*)::int AS "trackedSeconds",
            (count(*) FILTER (WHERE band = 1))::int AS light,
            (count(*) FILTER (WHERE band = 2))::int AS moderate,
            (count(*) FILTER (WHERE band = 3))::int AS high
        FROM samples WHERE day >= ${first}::date AND day < ${next}::date
        GROUP BY day ORDER BY day`;
    return {
        month, days: rows.map(({ date, trackedSeconds, ...intensity }) => ({
            date, trackedSeconds, activeSeconds: activeSeconds(intensity), intensity,
        })),
    };
}

export async function getDay(userId: number, date: string, timeZone: string) {
    await requireUser(userId, 'patient');
    const [{ start, end }] = await prisma.$queryRaw<Array<{ start: Date; end: Date }>>`
        SELECT ${date}::date::timestamp AT TIME ZONE ${timeZone} AS start,
            ${nextDate(date, 'day')}::date::timestamp AT TIME ZONE ${timeZone} AS "end"`;
    const [windows, routines, latest] = await Promise.all([
        prisma.fitnessWindow.findMany({
            where: {
                userId,
                recordedAt: {
                    gte: new Date(start.getTime() - lastSlotOffset - contextRadiusMs),
                    lte: new Date(end.getTime() + contextRadiusMs),
                },
            },
            orderBy: { recordedAt: 'asc' },
            select: { recordedAt: true, bands: true, context: true },
        }),
        prisma.routineCompletion.findMany({
            where: { userId, completedAt: { gte: start, lt: end } },
            select: { routineKey: true, completedAt: true },
        }),
        prisma.fitnessWindow.findFirst({
            where: { userId }, orderBy: { recordedAt: 'desc' }, select: { recordedAt: true, context: true },
        }),
    ]);
    const { timeline, ...summary } = analyzeDay(windows.map(w => ({
        ...w, context: w.context as ObservedWindow['context'],
    })), start, end);
    const history = [
        ...timeline,
        ...routines.map(({ routineKey, completedAt }) => ({
            kind: 'routine' as const, routineKey, title: routineTitle.get(routineKey) ?? routineKey, completedAt,
        })),
    ].sort((a, b) => ('startedAt' in a ? a.startedAt : a.completedAt).getTime()
        - ('startedAt' in b ? b.startedAt : b.completedAt).getTime());
    const lastSlot = (latest?.context as ObservedWindow['context'] | undefined)
        ?.reduce((last, slot, index) => slot === null ? last : index, 0);
    const lastReadingAt = latest ? new Date(latest.recordedAt.getTime() + (lastSlot ?? 0) * 1000) : null;
    return { date, ...summary, lastReadingAt, timeline: history };
}

export async function getRoutines(userId: number, timeZone: string) {
    await requireUser(userId, 'patient');
    const date = localDate(new Date(), timeZone);
    const completions = await prisma.routineCompletion.findMany({
        where: { userId, localDate: date },
        select: { routineKey: true, completedAt: true },
    });
    const completedAt = new Map(completions.map(item => [item.routineKey, item.completedAt]));
    return { date, routines: ROUTINES.map(routine => ({ ...routine, completedAt: completedAt.get(routine.key) ?? null })) };
}

export async function completeRoutine(userId: number, routineKey: string, timeZone: string) {
    await requireUser(userId, 'patient');
    if (!routineTitle.has(routineKey)) throw new HttpError(404, 'Routine not found');
    const now = new Date();
    const date = localDate(now, timeZone);
    const key = { userId, routineKey, localDate: date };
    await prisma.routineCompletion.createMany({ data: { ...key, completedAt: now }, skipDuplicates: true });
    const { completedAt } = await prisma.routineCompletion.findUniqueOrThrow({
        where: { userId_routineKey_localDate: key }, select: { completedAt: true },
    });
    return { date, key: routineKey, completedAt };
}
