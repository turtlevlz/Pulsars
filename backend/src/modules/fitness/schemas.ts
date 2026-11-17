import { z } from 'zod';
import { VITALS } from '../vitals/types.js';

const deviceId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const sample = z.strictObject({
    motion_rms_g: z.number().min(0).max(8).nullable(),
    gyro_rms_dps: z.number().min(0).max(500).nullable(),
    pulse_bpm: z.number().min(VITALS.hr.min).max(VITALS.hr.max).nullable(),
    skin_temp_c: z.number().min(-55).max(125).nullable(),
}).refine(value => (value.motion_rms_g === null) === (value.gyro_rms_dps === null)
    && value.skin_temp_c !== 85, { message: 'Invalid fitness sensor reading' });

export const windowSchema = z.strictObject({
    v: z.literal(1),
    deviceId,
    bootId: deviceId,
    deviceTimeMs: z.int().nonnegative(),
    recordedAt: z.iso.datetime({ offset: true }).transform(value => new Date(value))
        .refine(value => value.getTime() <= Date.now() + 5 * 60_000, { message: 'recordedAt cannot be in the future' }),
    samples: z.array(sample.nullable()).length(10),
});

export type FitnessWindow = z.infer<typeof windowSchema>;

const timeZone = z.string().regex(/^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/).refine(value => {
    try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
    } catch {
        return false;
    }
}, { message: 'Expected an IANA time zone' });
export const timeZoneQuery = z.object({ timeZone });
export const calendarQuery = timeZoneQuery.extend({ month: z.string().regex(/^(?!0000|9999)\d{4}-(0[1-9]|1[0-2])$/) });
export const dayQuery = timeZoneQuery.extend({
    date: z.iso.date().refine(value => value.slice(0, 4) !== '0000' && value.slice(0, 4) !== '9999'),
});
