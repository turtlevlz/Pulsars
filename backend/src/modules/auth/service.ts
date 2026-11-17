import bcrypt from 'bcrypt';
import { prisma } from '../../db.js';
import { HttpError } from '../../middleware/errors.js';
import { createUser, getUser } from '../users/service.js';
import type { ChangePasswordBody, LoginBody, RegisterBody } from './schemas.js';
import { assertNotThrottled, clearFailures, recordFailure } from './throttle.js';
import { signToken } from './tokens.js';

// Compared against when the email is unknown, so "no such account" and "wrong password" take
// about the same time and can't be told apart by timing.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash('pulsars-dummy-password', 10));

async function session(userId: number) {
    const { tokenVersion } = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true } });
    return { token: await signToken({ userId, tokenVersion }), user: await getUser(userId) };
}

/** Self-service sign-up. Always creates a patient; medics are created by other medics (POST /users). */
export async function register(input: RegisterBody) {
    const user = await createUser({ ...input, role: 'patient' });
    return session(user.id);
}

export async function login({ email, password }: LoginBody, ip: string | undefined) {
    assertNotThrottled(ip, email);
    const user = await prisma.user.findUnique({ where: { email } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !ok) {
        recordFailure(ip, email);
        throw new HttpError(401, 'Invalid email or password');
    }
    clearFailures(ip, email);
    return session(user.id);
}

/**
 * Changing the password bumps `tokenVersion`, which invalidates every token issued before, on
 * every device; the response carries a fresh token for the caller. A wrong current password is
 * a 403, not a 401, so the client doesn't mistake it for an expired session.
 */
export async function changePassword(userId: number, { currentPassword, newPassword }: ChangePasswordBody, ip: string | undefined) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assertNotThrottled(ip, user.email);
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
        recordFailure(ip, user.email);
        throw new HttpError(403, 'Current password is incorrect');
    }
    clearFailures(ip, user.email);
    await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await bcrypt.hash(newPassword, 10), tokenVersion: { increment: 1 } },
    });
    return session(userId);
}
