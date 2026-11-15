import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import {
    createSymptomBody,
    idParams,
    listSymptomsQuery,
    updateSymptomBody,
    type CreateSymptomBody,
    type ListSymptomsQuery,
    type UpdateSymptomBody,
} from './schemas.js';
import * as service from './service.js';

// Mounted at the app root because it serves both /users/:id/symptoms and /symptoms/:id.
export const symptomsRouter = Router();

symptomsRouter.post('/users/:id/symptoms', validate({ params: idParams, body: createSymptomBody }), async (_req, res) => {
    const { params, body } = res.locals.valid;
    res.status(201).json(await service.createSymptom(params.id, body as CreateSymptomBody));
});

symptomsRouter.get('/users/:id/symptoms', validate({ params: idParams, query: listSymptomsQuery }), async (_req, res) => {
    const { params, query } = res.locals.valid;
    res.json(await service.listSymptoms(params.id, query as ListSymptomsQuery));
});

symptomsRouter.get('/symptoms/:id', validate({ params: idParams }), async (_req, res) => {
    res.json(await service.getSymptom(res.locals.valid.params.id));
});

symptomsRouter.patch('/symptoms/:id', validate({ params: idParams, body: updateSymptomBody }), async (_req, res) => {
    const { params, body } = res.locals.valid;
    res.json(await service.updateSymptom(params.id, body as UpdateSymptomBody));
});

symptomsRouter.delete('/symptoms/:id', validate({ params: idParams }), async (_req, res) => {
    await service.deleteSymptom(res.locals.valid.params.id);
    res.status(204).end();
});
