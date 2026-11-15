import { Router } from 'express';
import { actor, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { searchQuery, type SearchQuery } from './schemas.js';
import * as service from './service.js';

// What the medic dashboard's patient list needs. Medics only.
export const patientsRouter = Router();
patientsRouter.use('/patients', requireRole('medic'));

patientsRouter.get('/patients/search', validate({ query: searchQuery }), async (_req, res) => {
    res.json(await service.searchPatients((res.locals.valid.query as SearchQuery).q));
});

patientsRouter.get('/patients/overview', async (req, res) => {
    res.json(await service.overview(actor(req).id));
});
