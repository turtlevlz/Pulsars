import { afterAll, beforeEach, vi } from 'vitest';
import { prisma } from '../src/db.js';
import { setLlmClient } from '../src/llm/client.js';
import { waitForBackgroundWork } from '../src/modules/assistant/service.js';

const TABLES = [
    'followup_messages', 'followup_threads', 'questions', 'checkups', 'symptoms',
    'heart_rates', 'body_temps', 'blood_oxygens', 'users',
];

beforeEach(async () => {
    // Let background work from the previous test finish before the tables are wiped under it.
    await waitForBackgroundWork();

    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    if (!db.endsWith('_test')) throw new Error(`Refusing to truncate "${db}": not a test database`);
    await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);

    // Default model for every test: a canned question. Tests that care install their own.
    setLlmClient({ chat: async () => JSON.stringify({ question: 'Default question?', done: false }) });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(async () => {
    await waitForBackgroundWork();
    await prisma.$disconnect();
});
