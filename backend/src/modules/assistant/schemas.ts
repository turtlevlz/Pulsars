import { z } from 'zod';

export const idParams = z.object({ id: z.coerce.number().int().positive() });

export const answerBody = z.strictObject({
    answer: z.string().trim().min(1).max(2000),
});

const dateTime = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

export const userThreadsQuery = z
    .object({
        from: dateTime.optional(),
        to: dateTime.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
    })
    .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '`from` must not be after `to`' });

export type AnswerBody = z.infer<typeof answerBody>;
export type UserThreadsQuery = z.infer<typeof userThreadsQuery>;
