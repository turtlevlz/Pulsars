import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import {
    idParams,
    readingSchema,
    seriesQuery,
    summaryQuery,
    type Reading,
    type SeriesQuery,
    type SummaryQuery,
} from './schemas.js';
import * as service from './service.js';

export const vitalsRouter = Router();

// Manual / testing entry point; MQTT (step 6) feeds the same ingest().
// 201 when stored, 200 when it was a duplicate (same user + recordedAt) and was skipped.
vitalsRouter.post('/users/:id/vitals', validate({ params: idParams, body: readingSchema }), async (_req, res) => {
    const { params, body } = res.locals.valid;
    const result = await service.ingest(params.id, body as Reading);
    res.status(result.stored ? 201 : 200).json(result);
});

vitalsRouter.get('/users/:id/vitals', validate({ params: idParams, query: seriesQuery }), async (_req, res) => {
    const { params, query } = res.locals.valid;
    res.json(await service.getSeries(params.id, query as SeriesQuery));
});

vitalsRouter.get('/users/:id/vitals/latest', validate({ params: idParams }), async (_req, res) => {
    res.json(await service.getLatest(res.locals.valid.params.id));
});

vitalsRouter.get('/users/:id/vitals/summary', validate({ params: idParams, query: summaryQuery }), async (_req, res) => {
    const { params, query } = res.locals.valid;
    res.json(await service.getSummary(params.id, query as SummaryQuery));
});
