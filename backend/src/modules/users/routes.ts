import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
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

usersRouter.post('/', validate({ body: createUserBody }), async (_req, res) => {
    const user = await service.createUser(res.locals.valid.body as CreateUserBody);
    res.status(201).json(user);
});

usersRouter.get('/', validate({ query: listQuery }), async (_req, res) => {
    res.json(await service.listUsers(res.locals.valid.query as ListQuery));
});

usersRouter.get('/:id', validate({ params: idParams }), async (_req, res) => {
    res.json(await service.getUser(res.locals.valid.params.id));
});

usersRouter.patch('/:id', validate({ params: idParams, body: updateUserBody }), async (_req, res) => {
    const { params, body } = res.locals.valid;
    res.json(await service.updateUser(params.id, body as UpdateUserBody));
});

usersRouter.delete('/:id', validate({ params: idParams }), async (_req, res) => {
    await service.deleteUser(res.locals.valid.params.id);
    res.status(204).end();
});
