import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
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

checkupsRouter.post('/checkups', validate({ body: createCheckupBody }), async (_req, res) => {
    res.status(201).json(await service.createCheckup(res.locals.valid.body as CreateCheckupBody));
});

checkupsRouter.get('/users/:id/checkups', validate({ params: idParams, query: listCheckupsQuery }), async (_req, res) => {
    const { params, query } = res.locals.valid;
    res.json(await service.listCheckups(params.id, query as ListCheckupsQuery));
});

checkupsRouter.get('/checkups/:id', validate({ params: idParams }), async (_req, res) => {
    res.json(await service.getCheckup(res.locals.valid.params.id));
});

checkupsRouter.put('/checkups/:id/answers', validate({ params: idParams, body: submitAnswersBody }), async (_req, res) => {
    const { params, body } = res.locals.valid;
    res.json(await service.submitAnswers(params.id, body as SubmitAnswersBody));
});
