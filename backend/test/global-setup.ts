import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { testDatabaseUrl } from './test-db.js';

// Creates the test database if needed and applies all migrations to it.
export default async function setup() {
    const url = new URL(testDatabaseUrl());
    const dbName = url.pathname.slice(1);
    if (!/^[a-z0-9_]+_test$/.test(dbName)) {
        throw new Error(`Refusing to run tests against database "${dbName}": its name must match *_test`);
    }

    const admin = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
    await admin.connect();
    try {
        const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
        if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`); // name validated above
    } finally {
        await admin.end();
    }

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url.toString() }, // dotenv never overrides an existing value
        stdio: 'pipe',
    });
}
