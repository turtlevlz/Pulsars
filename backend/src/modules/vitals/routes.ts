import { Router } from 'express';
import { actor } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { assertCanViewPatient, assertIsPatient } from '../auth/access.js';
import {
    idParams,
    readingSchema,
    seriesQuery,
    summaryQuery,
    trendQuery,
    type Reading,
    type SeriesQuery,
    type SummaryQuery,
    type TrendQuery,
} from './schemas.js';
import * as service from './service.js';

export const vitalsRouter = Router();

// Manual / testing entry point; MQTT (step 6) feeds the same ingest().
// 201 when stored, 200 when it was a duplicate (same user + recordedAt) and was skipped.
vitalsRouter.post('/users/:id/vitals', validate({ params: idParams, body: readingSchema }), async (req, res) => {
    const { params, body } = res.locals.valid;
    assertIsPatient(actor(req), params.id);
    const result = await service.ingest(params.id, body as Reading);
    res.status(result.stored ? 201 : 200).json(result);
});

vitalsRouter.get('/users/:id/vitals', validate({ params: idParams, query: seriesQuery }), async (req, res) => {
    const { params, query } = res.locals.valid;
    await assertCanViewPatient(actor(req), params.id);
    res.json(await service.getSeries(params.id, query as SeriesQuery));
});

vitalsRouter.get('/users/:id/vitals/latest', validate({ params: idParams }), async (req, res) => {
    const { id } = res.locals.valid.params;
    await assertCanViewPatient(actor(req), id);
    res.json(await service.getLatest(id));
});

vitalsRouter.get('/users/:id/vitals/summary', validate({ params: idParams, query: summaryQuery }), async (req, res) => {
    const { params, query } = res.locals.valid;
    await assertCanViewPatient(actor(req), params.id);
    res.json(await service.getSummary(params.id, query as SummaryQuery));
});

vitalsRouter.get('/users/:id/vitals/trend', validate({ params: idParams, query: trendQuery }), async (req, res) => {
    const { params, query } = res.locals.valid;
    await assertCanViewPatient(actor(req), params.id);
    res.json(await service.getTrend(params.id, query as TrendQuery));
});
