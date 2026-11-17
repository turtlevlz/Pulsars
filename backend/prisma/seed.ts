import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
    if ((await prisma.user.count()) > 0) {
        console.log('Users already exist, skipping seed.');
        return;
    }
    // Development-only password for every seeded account; they sign in with the emails below.
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.user.createMany({
        data: [
            { name: 'Dr. Medic', email: 'medic@pulsars.local', role: 'medic', passwordHash },
            { name: 'Alice Patient', email: 'alice@pulsars.local', role: 'patient', passwordHash, age: 34, weight: 65, height: 168 },
            { name: 'Bob Patient', email: 'bob@pulsars.local', role: 'patient', passwordHash, age: 52, weight: 82, height: 180 },
        ],
    });
    console.log('Seeded 1 medic and 2 patients.');
}

main().finally(() => prisma.$disconnect());
