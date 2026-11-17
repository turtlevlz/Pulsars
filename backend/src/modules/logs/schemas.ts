import { z } from 'zod';
import { metricsConfig } from '../metrics/config.js';

export const idParams = z.object({ id: z.coerce.number().int().positive() });

export const LOG_KINDS = ['bp', 'sleep', 'core_temp', 'exercise', 'orthostatic'] as const;
export type LogKind = (typeof LOG_KINDS)[number];

const dateTime = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
// A log can be back-dated ("I took it an hour ago") but not made in the future (5 minutes of
// slack for clock skew), like symptoms.
const notInFuture = (d: Date) => d.getTime() <= Date.now() + 5 * 60_000;
const past = dateTime.refine(notInFuture, { message: 'cannot be in the future' });

export const POSTURES = ['supine', 'seated', 'standing'] as const;
export type Posture = (typeof POSTURES)[number];

const SYMPTOM_IDS = metricsConfig.log_symptoms.map((s) => s.id);
const symptomId = z.string().refine((id) => SYMPTOM_IDS.includes(id), { message: `must be one of ${SYMPTOM_IDS.join(', ')}` });
const symptoms = z.array(symptomId).max(SYMPTOM_IDS.length).default([]);

const systolic = z.number().int().min(50).max(300);
const diastolic = z.number().int().min(30).max(200);
const heartRate = z.number().int().min(20).max(250);

const bpValue = z
    .strictObject({
        systolic,
        diastolic,
        heartRate,
        posture: z.enum(POSTURES),
        restedFiveMinutes: z.boolean(),
        armAtHeartLevel: z.boolean(),
        symptoms,
    })
    .refine((v) => v.systolic > v.diastolic, { message: 'systolic must be above diastolic', path: ['systolic'] });

const sleepValue = z
    .strictObject({ bedtime: dateTime, wakeTime: past, quality: z.number().int().min(1).max(5).optional() })
    .refine((v) => v.wakeTime > v.bedtime, { message: 'wakeTime must be after bedtime', path: ['wakeTime'] })
    .refine((v) => v.wakeTime.getTime() - v.bedtime.getTime() <= 24 * 3600_000, {
        message: 'a night can be at most 24 hours',
        path: ['wakeTime'],
    });

const coreTempValue = z.strictObject({
    celsius: z.number().min(34).max(43),
    site: z.enum(['oral', 'core', 'tympanic', 'other']),
});

const exerciseValue = z.strictObject({ done: z.boolean(), minutes: z.number().int().min(1).max(600).optional() });

const standing = z.strictObject({ systolic, diastolic, heartRate });
const orthostaticValue = z.strictObject({ supine: standing, standing1: standing, standing3: standing, symptoms });

export const createLogBody = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('bp'), recordedAt: past.optional(), value: bpValue }),
    // a night is recorded at the moment of waking
    z.strictObject({ kind: z.literal('sleep'), value: sleepValue }),
    z.strictObject({ kind: z.literal('core_temp'), recordedAt: past.optional(), value: coreTempValue }),
    z.strictObject({ kind: z.literal('exercise'), recordedAt: past.optional(), value: exerciseValue }),
    z.strictObject({ kind: z.literal('orthostatic'), recordedAt: past.optional(), value: orthostaticValue }),
]);

export const listLogsQuery = z
    .object({
        kind: z.enum(LOG_KINDS).optional(),
        from: dateTime.optional(),
        to: dateTime.optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
    })
    .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '`from` must not be after `to`' });

export type BpValue = z.output<typeof bpValue>;
export type SleepValue = z.output<typeof sleepValue>;
export type CoreTempValue = z.output<typeof coreTempValue>;
export type ExerciseValue = z.output<typeof exerciseValue>;
export type OrthostaticValue = z.output<typeof orthostaticValue>;
export type CreateLogBody = z.output<typeof createLogBody>;
export type ListLogsQuery = z.output<typeof listLogsQuery>;
