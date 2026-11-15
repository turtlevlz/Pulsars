import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { idParams } from '../vitals/schemas.js';
import { calendarQuery, dayQuery, timeZoneQuery } from './schemas.js';
import { completeRoutine, getCalendar, getDay, getRoutines } from './service.js';

export const fitnessRouter = Router();
const base = '/users/:id/fitness';

fitnessRouter.get(`${base}/calendar`, validate({ params: idParams, query: calendarQuery }), async (_req, res) => {
    const { month, timeZone } = res.locals.valid.query as z.infer<typeof calendarQuery>;
    res.json(await getCalendar(res.locals.valid.params.id, month, timeZone));
});

fitnessRouter.get(`${base}/day`, validate({ params: idParams, query: dayQuery }), async (_req, res) => {
    const { date, timeZone } = res.locals.valid.query as z.infer<typeof dayQuery>;
    res.json(await getDay(res.locals.valid.params.id, date, timeZone));
});

fitnessRouter.get(`${base}/routines`, validate({ params: idParams, query: timeZoneQuery }), async (_req, res) => {
    res.json(await getRoutines(res.locals.valid.params.id, res.locals.valid.query.timeZone));
});

fitnessRouter.put(`${base}/routines/:key/completion`, validate({
    params: idParams.extend({ key: z.string().min(1).max(32) }), body: timeZoneQuery,
}), async (_req, res) => {
    const { id, key } = res.locals.valid.params;
    res.json(await completeRoutine(id, key, res.locals.valid.body.timeZone));
});
