// Recomputes users.avg_* / *_count from the raw readings. Use if the cached lifetime
// averages ever drift (docs/plan.md §3.1). Idempotent.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { VITALS, VITAL_TYPES } from '../src/modules/vitals/types.js';

const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const ident = (name: string) => Prisma.raw(`"${name}"`);

async function main() {
    for (const type of VITAL_TYPES) {
        const v = VITALS[type];
        // Users with no readings go back to avg NULL / count 0.
        const updated = await prisma.$executeRaw`
            UPDATE "users" u
            SET ${ident(v.avg)} = s."avg", ${ident(v.count)} = COALESCE(s."count", 0)
            FROM "users" u2
            LEFT JOIN (
                SELECT "user_id", AVG(${ident(v.column)}) AS "avg", COUNT(*)::int AS "count"
                FROM ${ident(v.table)} GROUP BY "user_id"
            ) s ON s."user_id" = u2."id"
            WHERE u."id" = u2."id"`;
        console.log(`${type}: rebuilt ${updated} users`);
    }
}

main().finally(() => prisma.$disconnect());
