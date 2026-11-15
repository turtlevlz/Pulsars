import { z } from 'zod';

const age = z.number().int().min(0).max(130);
const weight = z.number().min(1).max(500); // kg
const height = z.number().min(30).max(272); // cm

export const idParams = z.object({ id: z.coerce.number().int().positive() });

export const listQuery = z.object({
    role: z.enum(['patient', 'medic']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

// Strict: unknown keys (role, avg_*, *_count, ...) are rejected, not silently ignored.
export const createUserBody = z.strictObject({
    name: z.string().trim().min(1).max(100),
    password: z.string().min(8).max(72), // bcrypt ignores bytes past 72
    role: z.enum(['patient', 'medic']).default('patient'),
    age: age.optional(),
    weight: weight.optional(),
    height: height.optional(),
});

// Role is intentionally not updatable: a medic with assigned check-ups must stay a medic.
export const updateUserBody = z
    .strictObject({
        name: z.string().trim().min(1).max(100),
        password: z.string().min(8).max(72),
        age: age.nullable(),
        weight: weight.nullable(),
        height: height.nullable(),
    })
    .partial()
    .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update' });

export type ListQuery = z.infer<typeof listQuery>;
export type CreateUserBody = z.infer<typeof createUserBody>;
export type UpdateUserBody = z.infer<typeof updateUserBody>;
