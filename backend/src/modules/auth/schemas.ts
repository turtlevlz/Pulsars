import { z } from 'zod';
import { email, newPassword } from '../users/schemas.js';

// Public sign-up only ever creates patients, so there is no `role` field (strict: sending one is a 400).
export const registerBody = z.strictObject({
    name: z.string().trim().min(1).max(100),
    email,
    password: newPassword,
    age: z.number().int().min(0).max(130).optional(),
    weight: z.number().min(1).max(500).optional(),
    height: z.number().min(30).max(272).optional(),
});

// Length caps only: a login must never reveal the rules a password was created under.
export const loginBody = z.strictObject({
    email,
    password: z.string().min(1).max(200),
});

export const changePasswordBody = z.strictObject({
    currentPassword: z.string().min(1).max(200),
    newPassword,
});

export type RegisterBody = z.infer<typeof registerBody>;
export type LoginBody = z.infer<typeof loginBody>;
export type ChangePasswordBody = z.infer<typeof changePasswordBody>;
