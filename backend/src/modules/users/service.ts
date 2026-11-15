import bcrypt from 'bcrypt';
import { prisma } from '../../db.js';
import { Prisma, type Role } from '../../generated/prisma/client.js';
import { HttpError } from '../../middleware/errors.js';
import type { CreateUserBody, ListQuery, UpdateUserBody } from './schemas.js';

const BCRYPT_ROUNDS = 10;

// Every read goes through this so the hash can never leak into a response.
const omitHash = { passwordHash: true } as const;

export function createUser(input: CreateUserBody) {
    const { password, ...rest } = input;
    return bcrypt
        .hash(password, BCRYPT_ROUNDS)
        .then((passwordHash) => prisma.user.create({ data: { ...rest, passwordHash }, omit: omitHash }));
}

export function listUsers({ role, limit, offset }: ListQuery) {
    return prisma.user.findMany({
        where: { role },
        orderBy: { id: 'asc' },
        take: limit,
        skip: offset,
        omit: omitHash,
    });
}

export function getUser(id: number) {
    return prisma.user.findUniqueOrThrow({ where: { id }, omit: omitHash });
}

export async function updateUser(id: number, input: UpdateUserBody) {
    const { password, ...rest } = input;
    const data: Prisma.UserUpdateInput = { ...rest };
    if (password !== undefined) data.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    return prisma.user.update({ where: { id }, data, omit: omitHash });
}

export async function deleteUser(id: number) {
    try {
        await prisma.user.delete({ where: { id } });
    } catch (err) {
        // checkups.medic_id has no cascade: a medic who assigned check-ups can't be deleted.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
            throw new HttpError(409, 'User is still referenced by check-ups they assigned');
        }
        throw err;
    }
}

/**
 * For other modules (check-ups, symptoms, vitals): load a user and optionally assert
 * their role, e.g. `requireUser(medicId, 'medic')`. Throws 404 if missing, 400 on wrong role.
 */
export async function requireUser(id: number, role?: Role) {
    const user = await prisma.user.findUnique({ where: { id }, omit: omitHash });
    if (!user) throw new HttpError(404, `User ${id} not found`);
    if (role && user.role !== role) throw new HttpError(400, `User ${id} is not a ${role}`);
    return user;
}
