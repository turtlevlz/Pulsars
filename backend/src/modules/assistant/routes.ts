import { Router } from 'express';
import { actor } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { assertCanViewPatient, assertIsPatient, symptomOwnerId, threadOwnerId } from '../auth/access.js';
import { answerBody, idParams, userThreadsQuery, type AnswerBody, type UserThreadsQuery } from './schemas.js';
import * as service from './service.js';

// Mounted at the app root. Follow-up threads belong to a symptom; the last route is the
// read-only overview a medic uses to see a patient's threads next to their check-ups.
export const assistantRouter = Router();

assistantRouter.post('/symptoms/:id/threads', validate({ params: idParams }), async (req, res) => {
    const { id } = res.locals.valid.params;
    assertIsPatient(actor(req), await symptomOwnerId(id));
    res.status(201).json(await service.openThread(id));
});

assistantRouter.get('/symptoms/:id/threads', validate({ params: idParams }), async (req, res) => {
    const { id } = res.locals.valid.params;
    await assertCanViewPatient(actor(req), await symptomOwnerId(id));
    res.json(await service.listThreads(id));
});

assistantRouter.get('/threads/:id', validate({ params: idParams }), async (req, res) => {
    const { id } = res.locals.valid.params;
    await assertCanViewPatient(actor(req), await threadOwnerId(id));
    res.json(await service.getThread(id));
});

// Only the patient answers; a medic's view of a thread is read-only.
assistantRouter.post('/threads/:id/messages', validate({ params: idParams, body: answerBody }), async (req, res) => {
    const { params, body } = res.locals.valid;
    assertIsPatient(actor(req), await threadOwnerId(params.id));
    res.json(await service.submitAnswer(params.id, (body as AnswerBody).answer));
});

assistantRouter.get('/users/:id/threads', validate({ params: idParams, query: userThreadsQuery }), async (req, res) => {
    const { params, query } = res.locals.valid;
    await assertCanViewPatient(actor(req), params.id);
    res.json(await service.listUserThreads(params.id, query as UserThreadsQuery));
});
