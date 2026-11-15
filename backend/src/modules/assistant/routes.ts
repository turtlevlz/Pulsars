import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { answerBody, idParams, userThreadsQuery, type AnswerBody, type UserThreadsQuery } from './schemas.js';
import * as service from './service.js';

// Mounted at the app root. Follow-up threads belong to a symptom; the last route is the
// read-only overview a medic uses to see a patient's threads next to their check-ups.
export const assistantRouter = Router();

assistantRouter.post('/symptoms/:id/threads', validate({ params: idParams }), async (_req, res) => {
    res.status(201).json(await service.openThread(res.locals.valid.params.id));
});

assistantRouter.get('/symptoms/:id/threads', validate({ params: idParams }), async (_req, res) => {
    res.json(await service.listThreads(res.locals.valid.params.id));
});

assistantRouter.get('/threads/:id', validate({ params: idParams }), async (_req, res) => {
    res.json(await service.getThread(res.locals.valid.params.id));
});

assistantRouter.post('/threads/:id/messages', validate({ params: idParams, body: answerBody }), async (_req, res) => {
    const { params, body } = res.locals.valid;
    res.json(await service.submitAnswer(params.id, (body as AnswerBody).answer));
});

assistantRouter.get('/users/:id/threads', validate({ params: idParams, query: userThreadsQuery }), async (_req, res) => {
    const { params, query } = res.locals.valid;
    res.json(await service.listUserThreads(params.id, query as UserThreadsQuery));
});
