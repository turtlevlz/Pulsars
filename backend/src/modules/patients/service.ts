import { prisma } from '../../db.js';
import { openAlertSummary } from '../alerts/service.js';
import { getLatest } from '../vitals/service.js';

const SEARCH_LIMIT = 20;

/**
 * Find a patient by name, to assign them a first check-up. Deliberately thin: id and name only,
 * so it is not a way to browse other people's details. (Any medic can assign a check-up to any
 * patient, which is what then gives access; see docs/plan.md, Auth.)
 */
export function searchPatients(q: string) {
    return prisma.user.findMany({
        where: { role: 'patient', name: { contains: q, mode: 'insensitive' } },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: SEARCH_LIMIT,
    });
}

/**
 * The medic's patients (everyone they have assigned a check-up to) with what the roster needs:
 * when the last reading arrived, how many alerts nobody has acknowledged yet and how bad the worst is.
 */
export async function overview(medicId: number) {
    const patients = await prisma.user.findMany({
        where: { role: 'patient', patientCheckups: { some: { medicId } } },
        select: { id: true, name: true, age: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return Promise.all(
        patients.map(async (patient) => {
            const latest = Object.values(await getLatest(patient.id));
            const times = latest.flatMap((l) => (l ? [l.recordedAt.getTime()] : []));
            const alerts = await openAlertSummary(patient.id);
            return {
                ...patient,
                lastReadingAt: times.length > 0 ? new Date(Math.max(...times)) : null,
                openAlerts: alerts.count,
                /** The worst level among the open alerts, for the roster chip. */
                openAlertLevel: alerts.topLevel,
            };
        }),
    );
}
