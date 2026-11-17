import { Router } from 'express';
import { actor, authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { getUser } from '../users/service.js';
import {
    changePasswordBody,
    loginBody,
    registerBody,
    type ChangePasswordBody,
    type LoginBody,
    type RegisterBody,
} from './schemas.js';
import * as service from './service.js';

// Mounted before the global authenticate middleware: register and login are the public entry points.
export const authRouter = Router();

authRouter.post('/register', validate({ body: registerBody }), async (_req, res) => {
    res.status(201).json(await service.register(res.locals.valid.body as RegisterBody));
});

authRouter.post('/login', validate({ body: loginBody }), async (req, res) => {
    res.json(await service.login(res.locals.valid.body as LoginBody, req.ip));
});

authRouter.get('/me', authenticate, async (req, res) => {
    res.json(await getUser(actor(req).id));
});

authRouter.post('/password', authenticate, validate({ body: changePasswordBody }), async (req, res) => {
    res.json(await service.changePassword(actor(req).id, res.locals.valid.body as ChangePasswordBody, req.ip));
});
