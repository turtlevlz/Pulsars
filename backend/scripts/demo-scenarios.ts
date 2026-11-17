// Demo scenarios for the health tiers (spec section 12, question 4): a few synthetic situations that
// show "measure -> interpret -> act" without a wearable. Each one creates its OWN throwaway user
// (never Alice or Bob), fills in days of ordinary history so the personal baselines exist, then
// the last hours of the scenario, and prints the tiers it expects next to the ones the engine gives.
//
//   npm run demo -- infection|sleep-debt|hypoxia|orthostatic [--days 8] [--live] [--no-medic]
//   npm run demo -- list       the demo users that exist
//   npm run demo -- cleanup    delete every demo user (and with it their data)
//
// Demo users sign in with the password printed at the end. The readings are written straight to the
// database up to the current minute, so the tiers hold for about 10-15 minutes (then the data is
// stale and the tiles go gray, which is the rule working). `--live` keeps adding a reading every
// 10 seconds until Ctrl+C, for a longer demo.
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { pathToFileURL } from 'node:url';
import { prisma } from '../src/db.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { getStatus } from '../src/modules/metrics/service.js';
import { MINUTE } from '../src/modules/metrics/types.js';

export const SCENARIOS = ['infection', 'sleep-debt', 'hypoxia', 'orthostatic'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const DEMO_DOMAIN = 'pulsars.demo';
export const DEMO_PASSWORD = 'demo-password-123';

/** What each scenario should produce. The tests assert these; the script prints them. */
export const EXPECTED: Record<Scenario, { story: string; tiers: Record<string, string>; rules: string[] }> = {
    infection: {
        story: 'Skin temperature about 0.9 °C above their own curve and a resting heart rate about 24% above baseline for three hours, and a low blood pressure logged: possible volume loss or infection.',
        tiers: { hr_resting: 'yellow', skin_temp: 'yellow', spo2: 'green', bp: 'yellow', sleep: 'green', symptoms: 'green' },
        rules: ['volume_loss_or_infection'],
    },
    'sleep-debt': {
        story: 'Seven nights of about 5.3 hours of logged sleep. The body is coping (heart rate and temperature normal), but the 7-day average is below 6 hours.',
        tiers: { hr_resting: 'green', skin_temp: 'green', spo2: 'green', bp: 'green', sleep: 'red', symptoms: 'green' },
        rules: [],
    },
    hypoxia: {
        story: 'Blood oxygen drops from 97% to 93% and then to about 87% for 8 minutes while the person is still. Never a single reading: several minutes in a row.',
        tiers: { hr_resting: 'green', skin_temp: 'green', spo2: 'red', bp: 'green', sleep: 'green', symptoms: 'green' },
        rules: [],
    },
    orthostatic: {
        story: 'On the Moon: pressure falls 26/10 mmHg within 3 minutes of standing and the heart rate rises 34 bpm, which points to low fluid volume. No symptoms, so yellow.',
        tiers: { hr_resting: 'green', skin_temp: 'green', spo2: 'green', bp: 'green', sleep: 'green', symptoms: 'green', orthostatic: 'yellow' },
        rules: [],
    },
};

// ------------------------------------------------------------------ the synthetic person

const RESTING_HR = 66;
const USUAL_SKIN_TEMP = 33.2; // a day/night curve around this, see skinTemp()

// Deterministic "noise" in [-1, 1] so a scenario is the same every time it is run.
const noise = (seed: number) => {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
};

/** What the person is doing at a minute of the (UTC) day: asleep, a short walk, a workout, or still. */
function activity(t: number): { band: 0 | 1 | 2; hrOffset: number } {
    const minuteOfDay = (t / MINUTE) % 1440;
    if (minuteOfDay < 360) return { band: 0, hrOffset: -6 }; // asleep
    if (minuteOfDay >= 540 && minuteOfDay < 570) return { band: 1, hrOffset: 15 }; // walking around
    if (minuteOfDay >= 1080 && minuteOfDay < 1100) return { band: 2, hrOffset: 60 }; // workout
    return { band: 0, hrOffset: 0 };
}

const skinTemp = (t: number) => USUAL_SKIN_TEMP + 0.5 * Math.sin(((((t / 3600_000) % 24) - 15) / 24) * 2 * Math.PI);

/** How many minutes at the end of each scenario are the scenario itself (the person is still throughout). */
const TAIL_MINUTES: Record<Scenario, number> = { infection: 180, 'sleep-debt': 60, hypoxia: 30, orthostatic: 60 };

interface Sample {
    hr: number;
    bt: number;
    bo: number;
    band: 0 | 1 | 2;
}

/** One minute of the synthetic person; `end` is the end of the data, so the scenario's tail is known. */
export function sampleAt(t: number, scenario: Scenario, end: number): Sample {
    const n = t / MINUTE;
    const inTail = t >= end - TAIL_MINUTES[scenario] * MINUTE;
    const { band, hrOffset } = inTail ? { band: 0 as const, hrOffset: 0 } : activity(t);
    let hr = RESTING_HR + hrOffset + noise(n) * 2;
    let bt = skinTemp(t) + noise(n + 0.5) * 0.05;
    let bo = 97 + noise(n + 0.25) * 0.8;

    if (inTail) {
        const minutesBeforeEnd = (end - t) / MINUTE;
        if (scenario === 'infection') {
            hr += 16; // 66 -> 82: 24% above the baseline
            bt += 0.9;
        }
        if (scenario === 'sleep-debt') hr += 3; // a little tired, still inside the 10% band
        if (scenario === 'hypoxia') {
            if (minutesBeforeEnd <= 8) bo = 86.5 + noise(n) * 1.2;
            else if (minutesBeforeEnd <= 14) bo = 93 + noise(n) * 0.6;
        }
    }
    return { hr: Math.round(hr * 10) / 10, bt: Math.round(bt * 100) / 100, bo: Math.round(bo * 10) / 10, band };
}

// ------------------------------------------------------------------ writing it

const CHUNK = 4000;
async function inChunks<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) {
    for (let i = 0; i < rows.length; i += CHUNK) await write(rows.slice(i, i + CHUNK));
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Writes `minutes` of readings ending at `end`: one reading a minute per vital, and the band's motion windows. */
async function writeMinutes(userId: number, scenario: Scenario, from: number, end: number) {
    const hr = [];
    const bt = [];
    const bo = [];
    const windows = [];
    for (let t = from; t < end; t += MINUTE) {
        const s = sampleAt(t, scenario, end);
        const at = new Date(t + 20_000);
        hr.push({ userId, heartRate: s.hr, recordedAt: at });
        bt.push({ userId, bodyTemp: s.bt, recordedAt: at });
        bo.push({ userId, bloodO: s.bo, recordedAt: at });
        for (let w = 0; w < 6; w++) {
            const start = t + w * 10_000;
            windows.push({
                userId,
                deviceId: 'demo',
                bootId: 'demo',
                deviceTimeMs: BigInt(start),
                recordedAt: new Date(start),
                bands: Array<number>(10).fill(s.band),
                context: Array(10).fill(null),
            });
        }
    }
    await inChunks(hr, (data) => prisma.heartRate.createMany({ data, skipDuplicates: true }));
    await inChunks(bt, (data) => prisma.bodyTemp.createMany({ data, skipDuplicates: true }));
    await inChunks(bo, (data) => prisma.bloodOxygen.createMany({ data, skipDuplicates: true }));
    await inChunks(windows, (data) => prisma.fitnessWindow.createMany({ data, skipDuplicates: true }));
}

const dayMs = 24 * 3600_000;

interface LogRow {
    userId: number;
    kind: string;
    recordedAt: Date;
    value: Prisma.InputJsonObject;
}

/** Seven nights ending with the most recent 06:30 UTC, `hours` long each. */
function sleepLogs(userId: number, end: number, hours: number): LogRow[] {
    const today = Math.floor(end / dayMs) * dayMs + 6.5 * 3600_000;
    const lastWake = today <= end ? today : today - dayMs;
    return Array.from({ length: 7 }, (_, d) => {
        const wake = lastWake - d * dayMs;
        return {
            userId,
            kind: 'sleep',
            recordedAt: new Date(wake),
            value: { bedtime: iso(wake - hours * 3600_000), wakeTime: iso(wake), quality: hours >= 7 ? 4 : 2 },
        };
    });
}

const bpValue = (systolic: number, diastolic: number, heartRate: number) => ({
    systolic,
    diastolic,
    heartRate,
    posture: 'seated',
    restedFiveMinutes: true,
    armAtHeartLevel: true,
    symptoms: [] as string[],
});

/** The manual entries of a scenario: ordinary blood-pressure logs for the baseline, plus what the story needs. */
function logsFor(userId: number, scenario: Scenario, end: number): LogRow[] {
    const logs = sleepLogs(userId, end, scenario === 'sleep-debt' ? 5.3 : 7.6);
    const bp = (msAgo: number, sys: number, dia: number, hr: number) =>
        logs.push({ userId, kind: 'bp', recordedAt: new Date(end - msAgo), value: bpValue(sys, dia, hr) });
    // four ordinary readings over the last week give the person a "usual" blood pressure
    bp(6.2 * dayMs, 112, 72, 64);
    bp(4.7 * dayMs, 114, 73, 64);
    bp(3.1 * dayMs, 110, 71, 64);
    bp(1.6 * dayMs, 113, 72, 64);
    if (scenario === 'infection') bp(90 * MINUTE, 88, 58, 84); // low, and the heart is racing
    else bp(3 * 3600_000, 114, 72, 64); // a recent normal one, so the tile is not stale
    if (scenario === 'orthostatic') {
        const r = (systolic: number, diastolic: number, heartRate: number) => ({ systolic, diastolic, heartRate });
        logs.push({
            userId,
            kind: 'orthostatic',
            recordedAt: new Date(end - 15 * MINUTE),
            value: { supine: r(118, 74, 64), standing1: r(96, 66, 92), standing3: r(92, 64, 98), symptoms: [] },
        });
    }
    return logs;
}

export interface SeedOptions {
    /** Days of ordinary history before the scenario. The baselines need at least 3; 8 is the demo default. */
    baselineDays?: number;
    now?: Date;
}

/** Fills a (new, empty) patient's database rows for a scenario. Returns the end of the data. */
export async function seedScenario(userId: number, scenario: Scenario, { baselineDays = 8, now = new Date() }: SeedOptions = {}) {
    const end = Math.floor(now.getTime() / MINUTE) * MINUTE;
    await writeMinutes(userId, scenario, end - baselineDays * dayMs, end);
    const logs = logsFor(userId, scenario, end);
    await prisma.logEntry.createMany({ data: logs });
    if (scenario === 'orthostatic') await prisma.user.update({ where: { id: userId }, data: { environmentProfile: 'moon' } });
    return end;
}

export async function createDemoUser(scenario: Scenario) {
    const stamp = Date.now().toString(36);
    return prisma.user.create({
        data: {
            name: `Demo (${scenario})`,
            email: `demo-${scenario}-${stamp}@${DEMO_DOMAIN}`,
            passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
            role: 'patient',
            age: 38,
            weight: 72,
            height: 175,
        },
        select: { id: true, name: true, email: true },
    });
}

/** Lets the seeded demo medic follow the demo user, so the medic dashboard shows it too. */
async function followWithMedic(patientId: number, scenario: Scenario): Promise<string | null> {
    const medic = await prisma.user.findFirst({ where: { role: 'medic', email: { not: { endsWith: `@${DEMO_DOMAIN}` } } }, orderBy: { id: 'asc' } });
    if (!medic) return null;
    await prisma.checkup.create({
        data: { userId: patientId, medicId: medic.id, name: `Demo check-up (${scenario})`, questions: { create: [{ question: 'How do you feel?' }] } },
    });
    return medic.email;
}

export async function deleteDemoUsers() {
    const { count } = await prisma.user.deleteMany({ where: { email: { endsWith: `@${DEMO_DOMAIN}` } } });
    return count;
}

// ------------------------------------------------------------------ the command line

function printTiers(scenario: Scenario, actual: Awaited<ReturnType<typeof getStatus>>) {
    const expected = EXPECTED[scenario];
    console.log(`\n${scenario}: ${expected.story}\n`);
    console.log('metric'.padEnd(14), 'expected'.padEnd(9), 'actual'.padEnd(8), 'why');
    for (const m of actual.metrics) {
        const want = expected.tiers[m.metricId] ?? '-';
        console.log(m.metricId.padEnd(14), want.padEnd(9), `${m.level}${want === m.level ? '' : ' (!)'}`.padEnd(8), m.reason);
    }
    for (const r of actual.rules) console.log(`rule ${r.ruleId}: ${r.level}`);
    const missing = expected.rules.filter((id) => !actual.rules.some((r) => r.ruleId === id));
    if (missing.length > 0) console.log(`expected rules that did not fire: ${missing.join(', ')}`);
}

async function live(userId: number, scenario: Scenario, end: number) {
    console.log('\nLive: adding a reading every 10 seconds. Ctrl+C to stop.');
    // keep the scenario's last state going: the same as the final minute of the seeded data
    const steady = sampleAt(end - MINUTE, scenario, end);
    const timer = setInterval(async () => {
        const now = Date.now();
        const at = new Date(now);
        const quiet = { userId, deviceId: 'demo', bootId: 'demo-live', deviceTimeMs: BigInt(now), recordedAt: new Date(now - 10_000), bands: Array<number>(10).fill(0), context: Array(10).fill(null) };
        await Promise.all([
            prisma.heartRate.create({ data: { userId, heartRate: Math.round((steady.hr + noise(now) * 1.5) * 10) / 10, recordedAt: at } }),
            prisma.bodyTemp.create({ data: { userId, bodyTemp: steady.bt, recordedAt: at } }),
            prisma.bloodOxygen.create({ data: { userId, bloodO: steady.bo, recordedAt: at } }),
            prisma.fitnessWindow.create({ data: quiet }),
        ]).catch((err) => console.error('live write failed:', err.message));
    }, 10_000);
    await new Promise<void>((resolve) => process.once('SIGINT', () => resolve()));
    clearInterval(timer);
}

async function main(argv: string[]) {
    const [command, ...rest] = argv;
    const flag = (name: string) => rest.includes(`--${name}`);
    const valueOf = (name: string) => {
        const i = rest.indexOf(`--${name}`);
        return i >= 0 ? rest[i + 1] : undefined;
    };

    if (command === 'cleanup') {
        console.log(`Deleted ${await deleteDemoUsers()} demo user(s).`);
        return;
    }
    if (command === 'list') {
        const users = await prisma.user.findMany({ where: { email: { endsWith: `@${DEMO_DOMAIN}` } }, select: { id: true, email: true } });
        for (const u of users) console.log(`${u.id}  ${u.email}`);
        if (users.length === 0) console.log('No demo users.');
        return;
    }
    if (!SCENARIOS.includes(command as Scenario)) {
        console.log(`Usage: npm run demo -- <${SCENARIOS.join('|')}> [--days 8] [--live] [--no-medic]\n       npm run demo -- list | cleanup`);
        process.exitCode = 1;
        return;
    }

    const scenario = command as Scenario;
    const days = Number(valueOf('days') ?? 8);
    const user = await createDemoUser(scenario);
    console.log(`Created demo user ${user.id} (${user.email}). Seeding ${days} days of history and the scenario...`);
    const end = await seedScenario(user.id, scenario, { baselineDays: days });
    const medic = flag('no-medic') ? null : await followWithMedic(user.id, scenario);

    printTiers(scenario, await getStatus(user.id));
    console.log(`\nSign in as ${user.email} / ${DEMO_PASSWORD}${medic ? `, or as ${medic} (this demo user is in their patient list)` : ''}.`);
    console.log('Delete the demo users with: npm run demo -- cleanup');
    if (flag('live')) await live(user.id, scenario, end);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main(process.argv.slice(2))
        .catch((err) => {
            console.error(err);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
