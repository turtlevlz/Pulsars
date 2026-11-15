import { z } from 'zod';

export const idParams = z.object({ id: z.coerce.number().int().positive() });

export const createCheckupBody = z.strictObject({
    userId: z.number().int().positive(), // the patient
    medicId: z.number().int().positive(),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(2000).optional(),
    dueAt: z.iso
        .datetime({ offset: true })
        .transform((s) => new Date(s))
        .refine((d) => d.getTime() > Date.now(), { message: 'dueAt must be in the future' })
        .optional(),
    questions: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
});

export const listCheckupsQuery = z.object({
    status: z.enum(['assigned', 'completed']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

export const submitAnswersBody = z
    .strictObject({
        answers: z
            .array(
                z.strictObject({
                    questionId: z.number().int().positive(),
                    answer: z.string().trim().min(1).max(2000),
                }),
            )
            .min(1)
            .max(50),
    })
    .refine((b) => new Set(b.answers.map((a) => a.questionId)).size === b.answers.length, {
        message: 'Each questionId may appear only once',
        path: ['answers'],
    });

export type CreateCheckupBody = z.infer<typeof createCheckupBody>;
export type ListCheckupsQuery = z.infer<typeof listCheckupsQuery>;
export type SubmitAnswersBody = z.infer<typeof submitAnswersBody>;
