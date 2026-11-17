import { z } from 'zod';

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
    // a metric id (`hr_resting`) or a cross-rule id (`volume_loss_or_infection`)
    ruleId: z.string().trim().min(1).max(64),
    startedAt: dateTime,
});

export type AlertsQuery = z.infer<typeof alertsQuery>;
export type AcknowledgeBody = z.infer<typeof acknowledgeBody>;
