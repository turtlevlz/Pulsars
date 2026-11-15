import { z } from 'zod';
import { VITAL_TYPES } from '../vitals/types.js';

export const idParams = z.object({ id: z.coerce.number().int().positive() });

const dateTime = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

export const alertsQuery = z
    .object({
        from: dateTime.optional(),
        to: dateTime.optional(),
        // `open` = not yet acknowledged
        status: z.enum(['open', 'all']).default('all'),
    })
    .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '`from` must not be after `to`' });

export const acknowledgeBody = z.strictObject({
    type: z.enum(VITAL_TYPES),
    startedAt: dateTime,
});

export type AlertsQuery = z.infer<typeof alertsQuery>;
export type AcknowledgeBody = z.infer<typeof acknowledgeBody>;
