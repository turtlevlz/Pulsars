import express from 'express';
import { prisma } from './db.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRouter } from './modules/auth/routes.js';
import { alertsRouter } from './modules/alerts/routes.js';
import { assistantRouter } from './modules/assistant/routes.js';
import { checkupsRouter } from './modules/checkups/routes.js';
import { patientsRouter } from './modules/patients/routes.js';
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

// Register and login are public; everything below this line needs a valid bearer token, and
// each route then checks what that user may do (modules/auth/access.ts).
app.use('/auth', authRouter);
app.use(authenticate);

// Feature routers are mounted here as modules are added (docs/plan.md §5).
app.use('/users', usersRouter);
app.use(symptomsRouter);
app.use(checkupsRouter);
app.use(vitalsRouter);
app.use(fitnessRouter);
app.use(assistantRouter);
app.use(alertsRouter);
app.use(patientsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
