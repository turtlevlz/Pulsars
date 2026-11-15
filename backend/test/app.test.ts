import { describe, expect, it } from 'vitest';
import { api } from './helpers.js';

describe('app', () => {
    it('reports healthy when the database is reachable', async () => {
        const res = await api().get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ok' });
    });

    it('returns a JSON 404 for unknown routes', async () => {
        const res = await api().get('/nope');
        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/not found/i);
    });

    it('returns 400 (not 500) for malformed JSON bodies', async () => {
        const res = await api().post('/users').set('content-type', 'application/json').send('{bad');
        expect(res.status).toBe(400);
    });
});
