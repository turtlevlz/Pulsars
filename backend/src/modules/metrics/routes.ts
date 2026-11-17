import { Router } from 'express';
import { actor } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { assertCanViewPatient } from '../auth/access.js';
import { metricsConfig } from './config.js';
import { idParams } from './schemas.js';
import * as service from './service.js';

export const metricsRouter = Router();

// The thresholds, evidence labels and plain-language explanations, for the frontend (and later the
// assistant) to read instead of keeping their own copy. Any signed-in user.
metricsRouter.get('/metrics/config', (_req, res) => {
    res.json(metricsConfig);
});

metricsRouter.get('/users/:id/metrics/status', validate({ params: idParams }), async (req, res) => {
    const { id } = res.locals.valid.params;
    await assertCanViewPatient(actor(req), id);
    res.json(await service.getStatus(id));
});
