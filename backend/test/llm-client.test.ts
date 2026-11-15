import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LlmError, createOpenAiCompatClient } from '../src/llm/client.js';

let server: Server | undefined;
afterEach(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server?.close(r));
    server = undefined;
});

async function fakeModel(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void) {
    server = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => handler(req, res, body));
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1`;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
};
const completion = (content: unknown) => ({ choices: [{ message: { role: 'assistant', content } }] });

describe('createOpenAiCompatClient', () => {
    it('posts an OpenAI-style chat completion request and returns the message content', async () => {
        let seen: { url?: string; method?: string; body?: any } = {};
        const url = await fakeModel((req, res, body) => {
            seen = { url: req.url, method: req.method, body: JSON.parse(body) };
            json(res, 200, completion('{"question":"Hi?","done":false}'));
        });
        const client = createOpenAiCompatClient({ url, model: 'test-model', timeoutMs: 2000 });
        const out = await client.chat([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }]);

        expect(out).toBe('{"question":"Hi?","done":false}');
        expect(seen.method).toBe('POST');
        expect(seen.url).toBe('/v1/chat/completions');
        expect(seen.body).toMatchObject({
            model: 'test-model',
            stream: false,
            response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }],
        });
    });

    it('tolerates a trailing slash on the base URL', async () => {
        let path = '';
        const url = await fakeModel((req, res) => {
            path = req.url!;
            json(res, 200, completion('ok'));
        });
        await createOpenAiCompatClient({ url: `${url}/`, model: 'm', timeoutMs: 2000 }).chat([]);
        expect(path).toBe('/v1/chat/completions');
    });

    it.each([
        ['an HTTP error', (res: ServerResponse) => json(res, 500, { error: 'model crashed' }), /HTTP 500/],
        ['no choices', (res: ServerResponse) => json(res, 200, { choices: [] }), /no message content/],
        ['empty content', (res: ServerResponse) => json(res, 200, completion('  ')), /no message content/],
        ['non-string content', (res: ServerResponse) => json(res, 200, completion({ a: 1 })), /no message content/],
        ['a body that is not JSON', (res: ServerResponse) => res.end('<html>'), /no message content/],
    ])('throws LlmError on %s', async (_label, respond, message) => {
        const url = await fakeModel((_req, res) => respond(res));
        const err = await createOpenAiCompatClient({ url, model: 'm', timeoutMs: 2000 }).chat([]).catch((e) => e);
        expect(err).toBeInstanceOf(LlmError);
        expect(err.message).toMatch(message);
    });

    it('throws LlmError when the model takes longer than the timeout', async () => {
        const url = await fakeModel(() => {
            /* never responds */
        });
        const started = Date.now();
        const err = await createOpenAiCompatClient({ url, model: 'm', timeoutMs: 150 }).chat([]).catch((e) => e);
        expect(err).toBeInstanceOf(LlmError);
        expect(err.message).toMatch(/timed out after 150ms/);
        expect(Date.now() - started).toBeLessThan(2000);
    });

    it('throws LlmError when nothing is listening', async () => {
        const url = await fakeModel((_req, res) => res.end());
        await new Promise((r) => server!.close(r)); // free the port, keep the URL
        const err = await createOpenAiCompatClient({ url, model: 'm', timeoutMs: 2000 }).chat([]).catch((e) => e);
        expect(err).toBeInstanceOf(LlmError);
        expect(err.message).toMatch(/LLM request failed/);
    });
});
