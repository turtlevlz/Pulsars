import { prisma } from '../src/db.js';
import { MINUTE } from '../src/modules/metrics/types.js';

// Seeding for the tests that go through the database: minutes of vitals, minutes of motion, and
// the person's baselines (written with a fresh timestamp, so the engine uses them as they are).

/** The start of the current minute: data that ends here is "just now" for the engine. */
export const minuteBoundary = (now = Date.now()) => Math.floor(now / MINUTE) * MINUTE;

/** `values.length` consecutive minutes ending at `end`, two readings a minute. */
export async function seedVitals(userId: number, type: 'hr' | 'bt' | 'bo', values: number[], end = minuteBoundary()) {
    const rows = values.flatMap((value, i) => {
        const start = end - (values.length - i) * MINUTE;
        return [0, 30].map((s) => ({ userId, recordedAt: new Date(start + s * 1000), value }));
    });
    if (type === 'hr') await prisma.heartRate.createMany({ data: rows.map((r) => ({ userId, heartRate: r.value, recordedAt: r.recordedAt })) });
    if (type === 'bt') await prisma.bodyTemp.createMany({ data: rows.map((r) => ({ userId, bodyTemp: r.value, recordedAt: r.recordedAt })) });
    if (type === 'bo') await prisma.bloodOxygen.createMany({ data: rows.map((r) => ({ userId, bloodO: r.value, recordedAt: r.recordedAt })) });
}

export const constant = (value: number, minutes: number) => Array<number>(minutes).fill(value);

/** Ten-second wrist-band windows for `minutes` minutes ending at `end`: all quiet (band 0), or all one band. */
export async function seedMotion(userId: number, minutes: number, band = 0, end = minuteBoundary()) {
    const start = end - minutes * MINUTE;
    const data = [];
    for (let t = start; t < end; t += 10_000) {
        data.push({
            userId,
            deviceId: 'test',
            bootId: 'test',
            deviceTimeMs: BigInt(t),
            recordedAt: new Date(t),
            bands: Array<number>(10).fill(band),
            context: Array(10).fill(null),
        });
    }
    await prisma.fitnessWindow.createMany({ data, skipDuplicates: true });
}

/** Quiet motion for `minutes` minutes plus heart rate `value` all that time: someone resting. */
export async function seedResting(userId: number, value: number, minutes: number, end = minuteBoundary()) {
    await seedMotion(userId, minutes, 0, end);
    await seedVitals(userId, 'hr', constant(value, minutes), end);
}

/** Stores the person's baselines as if just computed: resting heart rate, skin temperature at every hour. */
export async function setBaselines(userId: number, b: { hr?: number; temp?: number }) {
    const at = new Date();
    const rows = [
        ['hr_resting', b.hr === undefined ? { established: false } : { established: true, median: b.hr, restingMinutes: 500 }],
        ['skin_temp', b.temp === undefined ? { established: false } : { established: true, byHour: Array(24).fill(b.temp), days: 7 }],
        ['bp', { established: false }],
    ] as const;
    for (const [metricId, value] of rows) {
        await prisma.baseline.upsert({
            where: { userId_metricId: { userId, metricId } },
            create: { userId, metricId, rule: 'test', value, updatedAt: at },
            update: { value, updatedAt: at },
        });
    }
}
