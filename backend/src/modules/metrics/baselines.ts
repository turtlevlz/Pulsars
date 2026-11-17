import { prisma } from '../../db.js';
import { Prisma } from '../../generated/prisma/client.js';
import { metric } from './config.js';
import { computeBpBaselines, computeHrBaseline, computeTempCurve, restingMinutes, motionState, windowOf } from './dataset.js';
import { minuteMeans, motionMinutes } from './data.js';
import { DAY, MINUTE, type Baselines, type Logged, type MotionState } from './types.js';
import type { BpValue } from '../logs/schemas.js';

// Personal set points (spec section 2.2: set point plus alarm limits). They are worked out from the
// person's own data and kept in `baselines`; a row older than REFRESH_MS is recomputed on the next
// read. The last day (temperature) or six hours (heart rate) are left out so an illness that is in
// progress does not become the person's "normal".
export const REFRESH_MS = 15 * MINUTE;

type Stored = { established: boolean } & Record<string, unknown>;

async function compute(userId: number, now: number): Promise<Baselines> {
    const hr = metric('hr_resting');
    const temp = metric('skin_temp');
    const bp = metric('bp');

    const hrWin = windowOf(now, hr.params.baseline_days, hr.params.baseline_exclude_hours);
    const tempWin = windowOf(now, temp.params.baseline_days, temp.params.baseline_exclude_hours);

    const [hrMinutes, motion, tempMinutes, bpRows] = await Promise.all([
        minuteMeans(userId, 'hr', new Date(hrWin.from), new Date(hrWin.to)),
        motionMinutes(userId, new Date(hrWin.from), new Date(hrWin.to)),
        minuteMeans(userId, 'bt', new Date(tempWin.from), new Date(tempWin.to)),
        prisma.logEntry.findMany({
            where: { userId, kind: 'bp', recordedAt: { gte: new Date(now - bp.params.baseline_days * DAY), lte: new Date(now) } },
            orderBy: { recordedAt: 'asc' },
        }),
    ]);
    const states = new Map<number, MotionState>();
    for (const m of motion) {
        const s = motionState(m, hr.params);
        if (s) states.set(m.t, s);
    }
    const resting = restingMinutes(states, hr.params.rest_run_minutes);
    const bpLogs = bpRows.map((r): Logged<BpValue> => ({ at: r.recordedAt.getTime(), value: r.value as unknown as BpValue }));

    return {
        hr: computeHrBaseline(hrMinutes, resting, hrWin.from, hrWin.to, hr.params),
        temp: computeTempCurve(tempMinutes, tempWin.from, tempWin.to, temp.params),
        bp: computeBpBaselines(bpLogs, now),
    };
}

const IDS = ['hr_resting', 'skin_temp', 'bp'] as const;

function fromRows(rows: { metricId: string; value: unknown }[]): Baselines {
    const get = (id: string) => rows.find((r) => r.metricId === id)?.value as Stored | undefined;
    const hr = get('hr_resting');
    const temp = get('skin_temp');
    const bp = get('bp');
    return {
        hr: hr?.established ? { median: hr.median as number, restingMinutes: hr.restingMinutes as number } : null,
        temp: temp?.established ? { byHour: temp.byHour as (number | null)[], days: temp.days as number } : null,
        bp: bp?.established ? (bp.byPosture as Baselines['bp']) : {},
    };
}

/** The person's baselines, recomputed first if they are missing or older than 15 minutes. */
export async function ensureBaselines(userId: number, now = Date.now()): Promise<Baselines> {
    const rows = await prisma.baseline.findMany({ where: { userId, metricId: { in: [...IDS] } } });
    const fresh = IDS.every((id) => {
        const row = rows.find((r) => r.metricId === id);
        return row !== undefined && now - row.updatedAt.getTime() < REFRESH_MS && row.updatedAt.getTime() <= now + MINUTE;
    });
    if (fresh) return fromRows(rows);

    const b = await compute(userId, now);
    const at = new Date(now);
    const row = (metricId: string, rule: string, value: Stored) => ({ metricId, rule, value: value as Prisma.InputJsonValue });
    const next = [
        row('hr_resting', metric('hr_resting').baseline_rule, b.hr ? { established: true, ...b.hr } : { established: false }),
        row('skin_temp', metric('skin_temp').baseline_rule, b.temp ? { established: true, ...b.temp } : { established: false }),
        row('bp', metric('bp').baseline_rule, Object.keys(b.bp).length > 0 ? { established: true, byPosture: b.bp } : { established: false }),
    ];
    await Promise.all(
        next.map((r) =>
            prisma.baseline.upsert({
                where: { userId_metricId: { userId, metricId: r.metricId } },
                create: { userId, ...r, updatedAt: at },
                update: { rule: r.rule, value: r.value, updatedAt: at },
            }),
        ),
    );
    return b;
}
