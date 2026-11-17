import { prisma } from '../../db.js';
import { HttpError } from '../../middleware/errors.js';
import type { AuthUser } from '../../middleware/auth.js';

// Who may touch whose data (docs/plan.md, Later phases > Auth):
//  - a patient reads and writes their own data;
//  - a medic reads a patient's vitals, check-ups and follow-up threads once they have assigned
//    that patient a check-up, and never writes a patient's data;
//  - a check-up is visible to its patient and to the medic who assigned it.
// Routes for `/users/:id/...` answer 403 whether or not that user exists, so ids can't be probed.
// Routes for a single record (`/symptoms/:id`, ...) answer 404 for a missing record and 403 for
// somebody else's.

const forbidden = (message = 'You do not have access to this resource') => new HttpError(403, message);

export async function medicHasPatient(medicId: number, patientId: number): Promise<boolean> {
    const link = await prisma.checkup.findFirst({ where: { medicId, userId: patientId }, select: { id: true } });
    return link !== null;
}

/** Read access to a patient's data: the patient themselves, or a medic who has assigned them a check-up. */
export async function assertCanViewPatient(user: AuthUser, patientId: number): Promise<void> {
    if (user.id === patientId && user.role === 'patient') return;
    if (user.role === 'medic' && user.id !== patientId && (await medicHasPatient(user.id, patientId))) return;
    throw forbidden();
}

/** Write access to a patient's data: only the patient, never a medic. */
export function assertIsPatient(user: AuthUser, patientId: number): void {
    if (user.id !== patientId || user.role !== 'patient') throw forbidden('Only the patient can change this');
}

/** For an account's own profile (read, edit, delete). */
export function assertSelf(user: AuthUser, id: number): void {
    if (user.id !== id) throw forbidden();
}

/** A user's profile: their own, or a patient's for a medic who has assigned them a check-up. */
export async function assertCanViewUser(user: AuthUser, id: number): Promise<void> {
    if (user.id === id) return;
    return assertCanViewPatient(user, id);
}

export async function symptomOwnerId(symptomId: number): Promise<number> {
    const symptom = await prisma.symptom.findUnique({ where: { id: symptomId }, select: { userId: true } });
    if (!symptom) throw new HttpError(404, `Symptom ${symptomId} not found`);
    return symptom.userId;
}

export async function threadOwnerId(threadId: number): Promise<number> {
    const thread = await prisma.followupThread.findUnique({
        where: { id: threadId },
        select: { symptom: { select: { userId: true } } },
    });
    if (!thread) throw new HttpError(404, `Thread ${threadId} not found`);
    return thread.symptom.userId;
}

export async function checkupParties(checkupId: number): Promise<{ userId: number; medicId: number }> {
    const checkup = await prisma.checkup.findUnique({ where: { id: checkupId }, select: { userId: true, medicId: true } });
    if (!checkup) throw new HttpError(404, `Checkup ${checkupId} not found`);
    return checkup;
}
