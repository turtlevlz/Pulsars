import { Router } from 'express';
import { actor, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { assertCanViewPatient } from '../auth/access.js';
import { acknowledgeBody, alertsQuery, idParams, type AcknowledgeBody, type AlertsQuery } from './schemas.js';
import * as service from './service.js';

// Alerts are for the medic who follows the patient; patients don't see or acknowledge them.
export const alertsRouter = Router();

alertsRouter.get('/users/:id/alerts', requireRole('medic'), validate({ params: idParams, query: alertsQuery }), async (req, res) => {
    const { params, query } = res.locals.valid;
    await assertCanViewPatient(actor(req), params.id);
    res.json(await service.listAlerts(params.id, query as AlertsQuery));
});

alertsRouter.post(
    '/users/:id/alerts/acknowledge',
    requireRole('medic'),
    validate({ params: idParams, body: acknowledgeBody }),
    async (req, res) => {
        const { params, body } = res.locals.valid;
        const me = actor(req);
        await assertCanViewPatient(me, params.id);
        res.json(await service.acknowledge(params.id, me.id, body as AcknowledgeBody));
    },
);
