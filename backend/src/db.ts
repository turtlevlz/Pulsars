import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { config } from './config.js';

// Prisma's PostgreSQL adapter serializes and parses timestamps as UTC.
const databaseUrl = new URL(config.DATABASE_URL);
const options = databaseUrl.searchParams.get('options');
databaseUrl.searchParams.set('options', options ? `${options} -c timezone=UTC` : '-c timezone=UTC');

export const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl.href }),
});
