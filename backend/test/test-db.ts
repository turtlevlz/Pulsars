import 'dotenv/config';

/**
 * Tests run against their own database so they can freely truncate tables. Override with
 * TEST_DATABASE_URL; by default it is DATABASE_URL with the database renamed `<name>_test`.
 */
export function testDatabaseUrl(): string {
    if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
    const dev = process.env.DATABASE_URL ?? 'postgresql://pulsars:pulsars@localhost:5433/pulsars';
    const url = new URL(dev);
    url.pathname = `/${url.pathname.slice(1).replace(/_test$/, '')}_test`;
    return url.toString();
}
