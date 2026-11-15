import type { Request, RequestHandler } from 'express';
import { prisma } from '../db.js';
import type { Role } from '../generated/prisma/client.js';
import { verifyToken } from '../modules/auth/tokens.js';
import { HttpError } from './errors.js';

/** The signed-in user, as attached to `req.user` by authenticate(). */
export interface AuthUser {
    id: number;
    name: string;
    email: string;
    role: Role;
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}

/**
 * Requires `Authorization: Bearer <token>` and attaches the user to `req.user`. The user is
 * loaded on every request, so a deleted account or a password change takes effect at once.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
    const [scheme, token, ...extra] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token || extra.length > 0) {
        throw new HttpError(401, 'Authentication required');
    }

    const claims = await verifyToken(token);
    const user = await prisma.user.findUnique({
        where: { id: claims.userId },
        select: { id: true, name: true, email: true, role: true, tokenVersion: true },
    });
    if (!user || user.tokenVersion !== claims.tokenVersion) throw new HttpError(401, 'Invalid or expired token');

    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
};

/** The signed-in user of a request that has been through authenticate(). */
export function actor(req: Request): AuthUser {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user;
}

/** Route guard: only the given roles pass, everyone else gets a 403. */
export function requireRole(...roles: Role[]): RequestHandler {
    return (req, _res, next) => {
        if (!roles.includes(actor(req).role)) throw new HttpError(403, `Only ${roles.join(' or ')} accounts can do this`);
        next();
    };
}
