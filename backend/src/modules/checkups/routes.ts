import { Router } from 'express';
import { actor, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import { validate } from '../../middleware/validate.js';
import { assertCanViewPatient, assertIsPatient, checkupParties } from '../auth/access.js';
import {
    createCheckupBody,
    idParams,
    listCheckupsQuery,
    submitAnswersBody,
    type CreateCheckupBody,
    type ListCheckupsQuery,
    type SubmitAnswersBody,
} from './schemas.js';
import * as service from './service.js';

// Mounted at the app root: serves /checkups/... and /users/:id/checkups.
export const checkupsRouter = Router();

// A medic assigns a check-up under their own name; `medicId` may be left out, and naming
// another medic is refused. This is also what gives the medic read access to the patient.
checkupsRouter.post('/checkups', requireRole('medic'), validate({ body: createCheckupBody }), async (req, res) => {
    const body = res.locals.valid.body as CreateCheckupBody;
    const me = actor(req);
    if (body.medicId !== undefined && body.medicId !== me.id) {
        throw new HttpError(403, 'You can only assign check-ups as yourself');
    }
    res.status(201).json(await service.createCheckup({ ...body, medicId: me.id }));
});

// A patient lists their own check-ups, a medic the ones they assigned. A medic who asks about one
// of their patients gets only the check-ups they assigned, not other medics'.
checkupsRouter.get('/users/:id/checkups', validate({ params: idParams, query: listCheckupsQuery }), async (req, res) => {
    const { params, query } = res.locals.valid;
    const me = actor(req);
    if (me.id !== params.id) await assertCanViewPatient(me, params.id);
    res.json(await service.listCheckups(params.id, query as ListCheckupsQuery, me.id !== params.id ? me.id : undefined));
});

checkupsRouter.get('/checkups/:id', validate({ params: idParams }), async (req, res) => {
    const { id } = res.locals.valid.params;
    const { userId, medicId } = await checkupParties(id);
    const me = actor(req);
    if (me.id !== userId && me.id !== medicId) throw new HttpError(403, 'You do not have access to this resource');
    res.json(await service.getCheckup(id));
});

// Only the patient the check-up was assigned to can answer it.
checkupsRouter.put('/checkups/:id/answers', validate({ params: idParams, body: submitAnswersBody }), async (req, res) => {
    const { params, body } = res.locals.valid;
    assertIsPatient(actor(req), (await checkupParties(params.id)).userId);
    res.json(await service.submitAnswers(params.id, body as SubmitAnswersBody));
});
