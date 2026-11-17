import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

interface Schemas {
    body?: ZodType;
    query?: ZodType;
    params?: ZodType;
}

// Parsed, typed input is placed on res.locals.valid. In Express 5 req.query is a
// read-only getter, so it can't be overwritten with the parsed value.
export function validate(schemas: Schemas): RequestHandler {
    return (req, res, next) => {
        const valid: { body?: unknown; query?: unknown; params?: unknown } = {};
        if (schemas.body) valid.body = schemas.body.parse(req.body);
        if (schemas.query) valid.query = schemas.query.parse(req.query);
        if (schemas.params) valid.params = schemas.params.parse(req.params);
        res.locals.valid = valid;
        next();
    };
}
