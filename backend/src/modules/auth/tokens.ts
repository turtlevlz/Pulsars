import { SignJWT, jwtVerify } from 'jose';
import { config } from '../../config.js';
import { HttpError } from '../../middleware/errors.js';

// Login tokens are HS256 JWTs. They carry only who the user is (`sub`) and which password
// generation they belong to (`tv`); the role is always read from the database, so a token
// never outlives a change of role or the deletion of the account.
const key = new TextEncoder().encode(config.JWT_SECRET);
const ISSUER = 'pulsars';

export interface TokenClaims {
    userId: number;
    tokenVersion: number;
}

export function signToken({ userId, tokenVersion }: TokenClaims, expiresIn = `${config.JWT_TTL_HOURS}h`): Promise<string> {
    return new SignJWT({ tv: tokenVersion })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(String(userId))
        .setIssuer(ISSUER)
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(key);
}

/** Checks signature, algorithm, issuer and expiry. Any failure is the same 401, whatever the reason. */
export async function verifyToken(token: string): Promise<TokenClaims> {
    try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], issuer: ISSUER });
        const userId = Number(payload.sub);
        const tokenVersion = payload.tv;
        if (!Number.isInteger(userId) || userId < 1 || typeof tokenVersion !== 'number') throw new Error('bad claims');
        return { userId, tokenVersion };
    } catch {
        throw new HttpError(401, 'Invalid or expired token');
    }
}
