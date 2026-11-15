import express from 'express';
import { prisma } from './db.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { assistantRouter } from './modules/assistant/routes.js';
import { checkupsRouter } from './modules/checkups/routes.js';
import { symptomsRouter } from './modules/symptoms/routes.js';
import { vitalsRouter } from './modules/vitals/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { fitnessRouter } from './modules/fitness/routes.js';

export const app = express();

app.use(express.json());

app.get('/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
});

// Feature routers are mounted here as modules are added (docs/plan.md §5).
app.use('/users', usersRouter);
app.use(symptomsRouter);
app.use(checkupsRouter);
app.use(vitalsRouter);
app.use(fitnessRouter);
app.use(assistantRouter);

app.use(notFoundHandler);
app.use(errorHandler);
