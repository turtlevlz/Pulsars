import { Router } from 'express';
import { actor } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { assertCanViewPatient, assertIsPatient } from '../auth/access.js';
import { createLogBody, idParams, listLogsQuery, type CreateLogBody, type ListLogsQuery } from './schemas.js';
import * as service from './service.js';

// Manual entries: blood pressure, sleep, core temperature, exercise, orthostatic check. Only the
// patient writes them; the patient and the medic who follows them read them.
export const logsRouter = Router();

logsRouter.post('/users/:id/logs', validate({ params: idParams, body: createLogBody }), async (req, res) => {
    const { params, body } = res.locals.valid;
    assertIsPatient(actor(req), params.id);
    res.status(201).json(await service.createLog(params.id, body as CreateLogBody));
});

logsRouter.get('/users/:id/logs', validate({ params: idParams, query: listLogsQuery }), async (req, res) => {
    const { params, query } = res.locals.valid;
    await assertCanViewPatient(actor(req), params.id);
    res.json(await service.listLogs(params.id, query as ListLogsQuery));
});
