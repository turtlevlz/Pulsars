import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/test-db.js';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        globalSetup: ['./test/global-setup.ts'],
        setupFiles: ['./test/setup.ts'],
        env: {
            NODE_ENV: 'test',
            DATABASE_URL: testDatabaseUrl(),
            JWT_SECRET: 'test-secret-test-secret-test-secret-123',
        },
        // Test files share one database, so they run one after another.
        fileParallelism: false,
        testTimeout: 20_000,
        hookTimeout: 60_000,
    },
});
