import { config } from '../config.js';

export type ChatRole = 'system' | 'user' | 'assistant';
export interface ChatMessage {
    role: ChatRole;
    content: string;
}

/** The only thing the assistant needs from a model: messages in, text out. */
export interface LlmClient {
    chat(messages: ChatMessage[]): Promise<string>;
}

export class LlmError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LlmError';
    }
}

interface Options {
    url: string; // base URL including the version path, e.g. http://localhost:11434/v1
    model: string;
    timeoutMs: number;
}

/**
 * Client for any OpenAI-compatible /chat/completions endpoint: Ollama, the llama.cpp
 * server and LM Studio all expose one, so plain fetch is enough and no SDK is needed.
 */
export function createOpenAiCompatClient({ url, model, timeoutMs }: Options): LlmClient {
    const endpoint = `${url.replace(/\/+$/, '')}/chat/completions`;
    return {
        async chat(messages) {
            let res: Response;
            try {
                res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        model,
                        messages,
                        stream: false,
                        temperature: 0.3,
                        response_format: { type: 'json_object' },
                    }),
                    signal: AbortSignal.timeout(timeoutMs),
                });
            } catch (err) {
                const timedOut = err instanceof Error && err.name === 'TimeoutError';
                throw new LlmError(timedOut ? `LLM request timed out after ${timeoutMs}ms` : `LLM request failed: ${String(err)}`);
            }
            if (!res.ok) {
                const body = (await res.text().catch(() => '')).slice(0, 200);
                throw new LlmError(`LLM returned HTTP ${res.status}: ${body}`);
            }
            const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
            const content = data?.choices?.[0]?.message?.content;
            if (typeof content !== 'string' || content.trim() === '') throw new LlmError('LLM response had no message content');
            return content;
        },
    };
}

let current: LlmClient = createOpenAiCompatClient({
    url: config.LLM_URL,
    model: config.LLM_MODEL,
    timeoutMs: config.LLM_TIMEOUT_MS,
});

/** What the rest of the app imports. Indirection so tests can swap the model out. */
export const llm: LlmClient = { chat: (messages) => current.chat(messages) };

export function setLlmClient(client: LlmClient): void {
    current = client;
}
