import { Router } from 'express';
import { z } from 'zod';
import { actor } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { assertCanViewPatient, assertIsPatient } from '../auth/access.js';
import { idParams } from '../vitals/schemas.js';
import { calendarQuery, dayQuery, timeZoneQuery } from './schemas.js';
import { completeRoutine, getCalendar, getDay, getRoutines } from './service.js';

export const fitnessRouter = Router();
const base = '/users/:id/fitness';

fitnessRouter.get(`${base}/calendar`, validate({ params: idParams, query: calendarQuery }), async (req, res) => {
    const { month, timeZone } = res.locals.valid.query as z.infer<typeof calendarQuery>;
    await assertCanViewPatient(actor(req), res.locals.valid.params.id);
    res.json(await getCalendar(res.locals.valid.params.id, month, timeZone));
});

fitnessRouter.get(`${base}/day`, validate({ params: idParams, query: dayQuery }), async (req, res) => {
    const { date, timeZone } = res.locals.valid.query as z.infer<typeof dayQuery>;
    await assertCanViewPatient(actor(req), res.locals.valid.params.id);
    res.json(await getDay(res.locals.valid.params.id, date, timeZone));
});

fitnessRouter.get(`${base}/routines`, validate({ params: idParams, query: timeZoneQuery }), async (req, res) => {
    await assertCanViewPatient(actor(req), res.locals.valid.params.id);
    res.json(await getRoutines(res.locals.valid.params.id, res.locals.valid.query.timeZone));
});

fitnessRouter.put(`${base}/routines/:key/completion`, validate({
    params: idParams.extend({ key: z.string().min(1).max(32) }), body: timeZoneQuery,
}), async (req, res) => {
    const { id, key } = res.locals.valid.params;
    assertIsPatient(actor(req), id);
    res.json(await completeRoutine(id, key, res.locals.valid.body.timeZone));
});
