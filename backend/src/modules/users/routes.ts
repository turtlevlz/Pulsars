import { Router } from 'express';
import { actor, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { assertCanViewUser, assertSelf } from '../auth/access.js';
import {
    createUserBody,
    idParams,
    listQuery,
    updateUserBody,
    type CreateUserBody,
    type ListQuery,
    type UpdateUserBody,
} from './schemas.js';
import * as service from './service.js';

export const usersRouter = Router();

// Creating an account with a chosen role (a medic onboarding a colleague or a patient). Patients
// sign themselves up through POST /auth/register, which can only create patients.
usersRouter.post('/', requireRole('medic'), validate({ body: createUserBody }), async (_req, res) => {
    const user = await service.createUser(res.locals.valid.body as CreateUserBody);
    res.status(201).json(user);
});

// Lists only the accounts the caller may see: themselves and, for a medic, their patients.
usersRouter.get('/', validate({ query: listQuery }), async (req, res) => {
    res.json(await service.listUsers(res.locals.valid.query as ListQuery, actor(req)));
});

usersRouter.get('/:id', validate({ params: idParams }), async (req, res) => {
    const { id } = res.locals.valid.params;
    await assertCanViewUser(actor(req), id);
    res.json(await service.getUser(id));
});

usersRouter.patch('/:id', validate({ params: idParams, body: updateUserBody }), async (req, res) => {
    const { params, body } = res.locals.valid;
    assertSelf(actor(req), params.id);
    res.json(await service.updateUser(params.id, body as UpdateUserBody));
});

usersRouter.delete('/:id', validate({ params: idParams }), async (req, res) => {
    const { id } = res.locals.valid.params;
    assertSelf(actor(req), id);
    await service.deleteUser(id);
    res.status(204).end();
});
