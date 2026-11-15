import { z } from 'zod';
import { VITALS, VITAL_TYPES } from './types.js';

export const idParams = z.object({ id: z.coerce.number().int().positive() });

const vitalType = z.enum(VITAL_TYPES);
const dateTime = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

// A reading timestamp comes from the device, so it can't be in the future
// (5 minutes of slack for clock skew).
const recordedAt = dateTime.refine((d) => d.getTime() <= Date.now() + 5 * 60_000, {
    message: 'recordedAt cannot be in the future',
});

// Shared by the HTTP route and (in step 6) the MQTT subscriber.
export const readingSchema = z
    .strictObject({
        type: vitalType,
        value: z.number().finite(),
        recordedAt: recordedAt.optional(),
    })
    .superRefine((r, ctx) => {
        const { min, max, unit } = VITALS[r.type];
        if (r.value < min || r.value > max) {
            ctx.addIssue({
                code: 'custom',
                path: ['value'],
                message: `${r.type} must be between ${min} and ${max} ${unit}`,
            });
        }
    });

const range = { from: dateTime.optional(), to: dateTime.optional() };
const fromBeforeTo = (q: { from?: Date; to?: Date }) => !q.from || !q.to || q.from <= q.to;
const rangeMessage = { message: '`from` must not be after `to`' };

export const seriesQuery = z
    .object({ type: vitalType, ...range, limit: z.coerce.number().int().min(1).max(5000).default(500) })
    .refine(fromBeforeTo, rangeMessage);

export const summaryQuery = z.object(range).refine(fromBeforeTo, rangeMessage);

export type Reading = z.infer<typeof readingSchema>;
export type SeriesQuery = z.infer<typeof seriesQuery>;
export type SummaryQuery = z.infer<typeof summaryQuery>;
