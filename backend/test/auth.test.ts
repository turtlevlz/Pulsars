import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { signToken } from '../src/modules/auth/tokens.js';
import { api, hashPassword, makeMedic, makePatient } from './helpers.js';

const bearer = (token: string) => ({ token });
const secret = (s: string) => new TextEncoder().encode(s);
const TEST_SECRET = 'test-secret-test-secret-test-secret-123';

const newAccount = { name: 'Dana', email: 'dana@test.local', password: 'correct-horse-battery' };

async function accountWithPassword(password = 'correct-horse-battery', over: Record<string, unknown> = {}) {
    return makePatient({ email: 'dana@test.local', passwordHash: await hashPassword(password), ...over });
}

describe('POST /auth/register', () => {
    it('creates a patient and signs them in', async () => {
        const res = await api().post('/auth/register').send({ ...newAccount, age: 40, weight: 70, height: 170 });
        expect(res.status).toBe(201);
        expect(res.body.user).toMatchObject({ name: 'Dana', email: 'dana@test.local', role: 'patient', age: 40 });
        expect(res.body.user).not.toHaveProperty('passwordHash');
        expect(res.body.user).not.toHaveProperty('tokenVersion');
        expect(res.body.token).toEqual(expect.any(String));

        const me = await api(bearer(res.body.token)).get('/auth/me');
        expect(me.status).toBe(200);
        expect(me.body.id).toBe(res.body.user.id);

        const row = await prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id } });
        expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
    });

    it('cannot create a medic, however it is asked', async () => {
        for (const extra of [{ role: 'medic' }, { role: 'patient' }, { tokenVersion: 3 }]) {
            expect((await api().post('/auth/register').send({ ...newAccount, ...extra })).status).toBe(400);
        }
        expect(await prisma.user.count()).toBe(0);
    });

    it('normalises the email and refuses one that is already registered', async () => {
        const first = await api().post('/auth/register').send({ ...newAccount, email: ' Dana@Test.Local ' });
        expect(first.body.user.email).toBe('dana@test.local');
        expect((await api().post('/auth/register').send({ ...newAccount, email: 'DANA@test.local' })).status).toBe(409);
        expect(await prisma.user.count()).toBe(1);
    });

    it.each([
        ['short password', { password: 'short' }],
        ['password over 72 bytes', { password: 'é'.repeat(37) }],
        ['bad email', { email: 'dana' }],
        ['empty name', { name: ' ' }],
        ['absurd height', { height: 900 }],
    ])('rejects %s', async (_label, patch) => {
        expect((await api().post('/auth/register').send({ ...newAccount, ...patch })).status).toBe(400);
        expect(await prisma.user.count()).toBe(0);
    });
});

describe('POST /auth/login', () => {
    it('signs in with the right password, whatever the case of the email', async () => {
        const user = await accountWithPassword();
        const res = await api().post('/auth/login').send({ email: 'DANA@Test.Local', password: 'correct-horse-battery' });
        expect(res.status).toBe(200);
        expect(res.body.user).toMatchObject({ id: user.id, email: 'dana@test.local', role: 'patient' });
        expect(res.body.user).not.toHaveProperty('passwordHash');
        expect((await api(bearer(res.body.token)).get(`/users/${user.id}`)).status).toBe(200);
    });

    it('answers a wrong password and an unknown email identically', async () => {
        await accountWithPassword();
        const wrong = await api().post('/auth/login').send({ email: 'dana@test.local', password: 'not-the-password' });
        const unknown = await api().post('/auth/login').send({ email: 'nobody@test.local', password: 'correct-horse-battery' });
        expect(wrong.status).toBe(401);
        expect(unknown.status).toBe(401);
        expect(unknown.body).toEqual(wrong.body);
        expect(wrong.headers['www-authenticate']).toBe('Bearer');
    });

    it('rejects malformed requests', async () => {
        expect((await api().post('/auth/login').send({ email: 'dana@test.local' })).status).toBe(400);
        expect((await api().post('/auth/login').send({ email: 'nope', password: 'x' })).status).toBe(400);
        expect((await api().post('/auth/login').send({ email: 'a@b.co', password: 'x', role: 'medic' })).status).toBe(400);
    });

    it('stops guessing: five failures lock that email out for a while, even for the right password', async () => {
        await accountWithPassword();
        const attempt = (password: string) => api().post('/auth/login').send({ email: 'dana@test.local', password });
        for (let i = 0; i < 5; i++) expect((await attempt('wrong-' + i)).status).toBe(401);

        const locked = await attempt('correct-horse-battery');
        expect(locked.status).toBe(429);
        expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

        // other accounts are unaffected
        expect((await api().post('/auth/login').send({ email: 'other@test.local', password: 'x' })).status).toBe(401);
    });

    it('a successful sign-in resets the count', async () => {
        await accountWithPassword();
        const attempt = (password: string) => api().post('/auth/login').send({ email: 'dana@test.local', password });
        for (let round = 0; round < 3; round++) {
            for (let i = 0; i < 4; i++) expect((await attempt('wrong')).status).toBe(401);
            expect((await attempt('correct-horse-battery')).status).toBe(200);
        }
    });
});

describe('authentication', () => {
    it('keeps /health and the auth entry points public, and everything else behind a token', async () => {
        expect((await api().get('/health')).status).toBe(200);
        for (const path of ['/users', '/users/1', '/users/1/vitals/latest', '/checkups/1', '/threads/1', '/symptoms/1', '/auth/me', '/nope']) {
            const res = await api().get(path);
            expect(res.status, path).toBe(401);
            expect(res.headers['www-authenticate']).toBe('Bearer');
        }
    });

    it('refuses malformed Authorization headers', async () => {
        const user = await makePatient();
        const get = (header: string) => api().get('/auth/me').set('Authorization', header);
        expect((await get('')).status).toBe(401);
        expect((await get(user.token)).status).toBe(401); // no scheme
        expect((await get(`Basic ${user.token}`)).status).toBe(401);
        expect((await get('Bearer')).status).toBe(401);
        expect((await get(`Bearer ${user.token} extra`)).status).toBe(401);
        expect((await get('Bearer not.a.jwt')).status).toBe(401);
        expect((await get(`bearer ${user.token}`)).status).toBe(200); // the scheme is case-insensitive
    });

    it('refuses forged, tampered and expired tokens', async () => {
        const [a, b] = [await makePatient(), await makePatient()];
        const me = (token: string) => api(bearer(token)).get('/auth/me');
        expect((await me(a.token)).status).toBe(200);

        // payload swapped to another user, signature kept
        const [head, , sig] = a.token.split('.');
        const payload = Buffer.from(JSON.stringify({ sub: String(b.id), tv: 0, iss: 'pulsars', exp: 4_000_000_000 })).toString('base64url');
        expect((await me(`${head}.${payload}.${sig}`)).status).toBe(401);

        // signed with a different secret
        const foreign = await new SignJWT({ tv: 0 })
            .setProtectedHeader({ alg: 'HS256' })
            .setSubject(String(a.id))
            .setIssuer('pulsars')
            .setExpirationTime('1h')
            .sign(secret('some-other-secret-some-other-secret-1234'));
        expect((await me(foreign)).status).toBe(401);

        // unsigned ("alg: none")
        const none = [
            Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'),
            Buffer.from(JSON.stringify({ sub: String(a.id), tv: 0, iss: 'pulsars', exp: 4_000_000_000 })).toString('base64url'),
            '',
        ].join('.');
        expect((await me(none)).status).toBe(401);

        // a different HMAC algorithm is not accepted either
        const hs512 = await new SignJWT({ tv: 0 })
            .setProtectedHeader({ alg: 'HS512' })
            .setSubject(String(a.id))
            .setIssuer('pulsars')
            .setExpirationTime('1h')
            .sign(secret(TEST_SECRET));
        expect((await me(hs512)).status).toBe(401);

        // wrong issuer, expired, missing claims
        const make = (claims: Record<string, unknown>, issuer: string, exp: string, sub: string | null = String(a.id)) => {
            const jwt = new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuer(issuer).setExpirationTime(exp);
            return (sub ? jwt.setSubject(sub) : jwt).sign(secret(TEST_SECRET));
        };
        expect((await me(await make({ tv: 0 }, 'someone-else', '1h'))).status).toBe(401);
        expect((await me(await make({ tv: 0 }, 'pulsars', '1h', null))).status).toBe(401);
        expect((await me(await make({}, 'pulsars', '1h'))).status).toBe(401);
        expect((await me(await make({ tv: 0 }, 'pulsars', '1h', 'abc'))).status).toBe(401);
        expect((await me(await signToken({ userId: a.id, tokenVersion: 0 }, '-1m'))).status).toBe(401);
        expect((await me(await make({ tv: 0 }, 'pulsars', '1h'))).status).toBe(200); // control: the helper itself is sound
    });

    it('stops working when the account is deleted or the session counter moves on', async () => {
        const user = await makePatient();
        expect((await api(user).get('/auth/me')).status).toBe(200);
        await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
        expect((await api(user).get('/auth/me')).status).toBe(401);

        const gone = await makePatient();
        await prisma.user.delete({ where: { id: gone.id } });
        expect((await api(gone).get('/auth/me')).status).toBe(401);
    });

    it('takes the role from the database, not from the token', async () => {
        const patient = await makePatient();
        const forged = await new SignJWT({ tv: 0, role: 'medic' })
            .setProtectedHeader({ alg: 'HS256' })
            .setSubject(String(patient.id))
            .setIssuer('pulsars')
            .setExpirationTime('1h')
            .sign(secret(TEST_SECRET));
        const res = await api(bearer(forged)).post('/users').send({ name: 'x', email: 'x@test.local', password: 'longenough1' });
        expect(res.status).toBe(403);
    });
});

describe('GET /auth/me', () => {
    it('returns the signed-in profile for either role', async () => {
        const patient = await makePatient();
        const medic = await makeMedic();
        expect((await api(patient).get('/auth/me')).body).toMatchObject({ id: patient.id, role: 'patient', email: patient.email });
        expect((await api(medic).get('/auth/me')).body).toMatchObject({ id: medic.id, role: 'medic' });
    });
});

describe('POST /auth/password', () => {
    const change = (who: { token: string }, body: object) => api(who).post('/auth/password').send(body);

    it('changes the password, signs every other session out and returns a fresh token', async () => {
        const user = await accountWithPassword();
        const res = await change(user, { currentPassword: 'correct-horse-battery', newPassword: 'a-completely-new-one' });
        expect(res.status).toBe(200);
        expect(res.body.token).toEqual(expect.any(String));
        expect(res.body.user).not.toHaveProperty('passwordHash');

        expect((await api(user).get('/auth/me')).status).toBe(401); // the old token
        expect((await api(bearer(res.body.token)).get('/auth/me')).status).toBe(200);

        const login = (password: string) => api().post('/auth/login').send({ email: 'dana@test.local', password });
        expect((await login('a-completely-new-one')).status).toBe(200);
        expect((await login('correct-horse-battery')).status).toBe(401);
    });

    it('needs the current password (403, so a client does not mistake it for an expired session)', async () => {
        const user = await accountWithPassword();
        const res = await change(user, { currentPassword: 'wrong-wrong-wrong', newPassword: 'a-completely-new-one' });
        expect(res.status).toBe(403);
        expect((await api(user).get('/auth/me')).status).toBe(200);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tokenVersion).toBe(0);
    });

    it('is throttled like a login, so a stolen token cannot be used to guess the password', async () => {
        const user = await accountWithPassword();
        for (let i = 0; i < 5; i++) expect((await change(user, { currentPassword: 'nope', newPassword: 'a-completely-new-one' })).status).toBe(403);
        expect((await change(user, { currentPassword: 'correct-horse-battery', newPassword: 'a-completely-new-one' })).status).toBe(429);
    });

    it('applies the password rules to the new password and needs a token', async () => {
        const user = await accountWithPassword();
        expect((await change(user, { currentPassword: 'correct-horse-battery', newPassword: 'short' })).status).toBe(400);
        expect((await change(user, { currentPassword: 'correct-horse-battery' })).status).toBe(400);
        expect((await api().post('/auth/password').send({ currentPassword: 'a', newPassword: 'b'.repeat(10) })).status).toBe(401);
    });
});
