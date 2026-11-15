import { Router } from 'express';
import { actor } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { assertCanViewPatient, assertIsPatient, symptomOwnerId } from '../auth/access.js';
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

symptomsRouter.post('/users/:id/symptoms', validate({ params: idParams, body: createSymptomBody }), async (req, res) => {
    const { params, body } = res.locals.valid;
    assertIsPatient(actor(req), params.id);
    res.status(201).json(await service.createSymptom(params.id, body as CreateSymptomBody));
});

// Read-only for a medic who has assigned the patient a check-up (the medic dashboard shows it
// next to their vitals and threads). Everything that changes a symptom stays with the patient.
symptomsRouter.get('/users/:id/symptoms', validate({ params: idParams, query: listSymptomsQuery }), async (req, res) => {
    const { params, query } = res.locals.valid;
    await assertCanViewPatient(actor(req), params.id);
    res.json(await service.listSymptoms(params.id, query as ListSymptomsQuery));
});

symptomsRouter.get('/symptoms/:id', validate({ params: idParams }), async (req, res) => {
    const { id } = res.locals.valid.params;
    await assertCanViewPatient(actor(req), await symptomOwnerId(id));
    res.json(await service.getSymptom(id));
});

symptomsRouter.patch('/symptoms/:id', validate({ params: idParams, body: updateSymptomBody }), async (req, res) => {
    const { params, body } = res.locals.valid;
    assertIsPatient(actor(req), await symptomOwnerId(params.id));
    res.json(await service.updateSymptom(params.id, body as UpdateSymptomBody));
});

symptomsRouter.delete('/symptoms/:id', validate({ params: idParams }), async (req, res) => {
    const { id } = res.locals.valid.params;
    assertIsPatient(actor(req), await symptomOwnerId(id));
    await service.deleteSymptom(id);
    res.status(204).end();
});
