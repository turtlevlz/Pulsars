import { z } from 'zod';

export const idParams = z.object({ id: z.coerce.number().int().positive() });

const frequency = z.enum(['once', 'daily', 'several_daily', 'weekly', 'constant']);
const intensity = z.number().int().min(1).max(5);
const durationMinutes = z.number().int().positive().max(60 * 24 * 365);
const dateTime = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

// A symptom can be back-dated ("it started this morning") but not logged in the future
// (5 minutes of slack for clock skew).
const notInFuture = (d: Date) => d.getTime() <= Date.now() + 5 * 60_000;
const loggedAt = dateTime.refine(notInFuture, { message: 'loggedAt cannot be in the future' });

export const createSymptomBody = z.strictObject({
    name: z.string().trim().min(1).max(100),
    intensity,
    frequency,
    notes: z.string().trim().max(2000).optional(),
    durationMinutes: durationMinutes.optional(),
    loggedAt: loggedAt.optional(),
});

export const updateSymptomBody = z
    .strictObject({
        name: z.string().trim().min(1).max(100),
        intensity,
        frequency,
        notes: z.string().trim().max(2000).nullable(),
        durationMinutes: durationMinutes.nullable(),
        loggedAt,
    })
    .partial()
    .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update' });

export const listSymptomsQuery = z
    .object({
        from: dateTime.optional(),
        to: dateTime.optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
    })
    .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '`from` must not be after `to`' });

export type CreateSymptomBody = z.infer<typeof createSymptomBody>;
export type UpdateSymptomBody = z.infer<typeof updateSymptomBody>;
export type ListSymptomsQuery = z.infer<typeof listSymptomsQuery>;
