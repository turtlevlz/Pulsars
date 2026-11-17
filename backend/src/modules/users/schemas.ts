import { z } from 'zod';
import { PROFILE_IDS } from '../metrics/config.js';

const age = z.number().int().min(0).max(130);
const weight = z.number().min(1).max(500); // kg
const height = z.number().min(30).max(272); // cm

// Emails are stored lower-case so lookups are case-insensitive without a special index.
export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

// bcrypt only uses the first 72 bytes, so refuse longer passwords instead of silently truncating them.
export const newPassword = z
    .string()
    .min(8)
    .refine((s) => Buffer.byteLength(s) <= 72, { message: 'Password must be at most 72 bytes' });

export const idParams = z.object({ id: z.coerce.number().int().positive() });

export const listQuery = z.object({
    role: z.enum(['patient', 'medic']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

// Strict: unknown keys (role, avg_*, *_count, ...) are rejected, not silently ignored.
export const createUserBody = z.strictObject({
    name: z.string().trim().min(1).max(100),
    email,
    password: newPassword,
    role: z.enum(['patient', 'medic']).default('patient'),
    age: age.optional(),
    weight: weight.optional(),
    height: height.optional(),
});

// Role is intentionally not updatable: a medic with assigned check-ups must stay a medic.
// The password is not either: it changes through POST /auth/password, which asks for the
// current one and signs out other sessions.
export const updateUserBody = z
    .strictObject({
        name: z.string().trim().min(1).max(100),
        email,
        age: age.nullable(),
        weight: weight.nullable(),
        height: height.nullable(),
        // Where the person is (config/metrics.json "profiles"): decides which health checks are on.
        environmentProfile: z.string().refine((id) => PROFILE_IDS.includes(id), { message: `must be one of ${PROFILE_IDS.join(', ')}` }),
    })
    .partial()
    .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update' });

export type ListQuery = z.infer<typeof listQuery>;
export type CreateUserBody = z.infer<typeof createUserBody>;
export type UpdateUserBody = z.infer<typeof updateUserBody>;
