import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client.js';

export class HttpError extends Error {
    constructor(
        public readonly status: number,
        message: string,
        public readonly details?: unknown,
        public readonly headers?: Record<string, string>,
    ) {
        super(message);
        this.name = 'HttpError';
    }
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
    next(new HttpError(404, `Route not found: ${req.method} ${req.path}`));
};

// Express 5 forwards rejected promises from async handlers here automatically.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
        if (err.headers) res.set(err.headers);
        if (err.status === 401) res.set('WWW-Authenticate', 'Bearer');
        res.status(err.status).json({ error: err.message, details: err.details });
        return;
    }
    if (err instanceof ZodError) {
        res.status(400).json({ error: 'Validation failed', details: err.issues });
        return;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') {
            res.status(404).json({ error: 'Record not found' });
            return;
        }
        if (err.code === 'P2002') {
            res.status(409).json({ error: 'Record already exists' });
            return;
        }
        if (err.code === 'P2003') {
            res.status(400).json({ error: 'Referenced record does not exist' });
            return;
        }
    }
    // express.json() body parse errors carry a status
    const status = (err as { status?: number }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
        res.status(status).json({ error: (err as Error).message });
        return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
};
