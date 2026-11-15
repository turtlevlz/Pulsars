const API_URL = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, "");

/**
 * There is no login yet (auth is a later backend phase), so the dashboard acts as one
 * fixed patient. 2 is "Alice" from the backend seed.
 */
export const USER_ID = Number(import.meta.env.VITE_USER_ID ?? 2);

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

/** First validation problem from the backend's `{ error, details: [{ message }] }` body. */
function describe(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const { error, details } = body as { error: unknown; details?: unknown };
    if (typeof error === "string") {
      const first = Array.isArray(details) ? details[0]?.message : undefined;
      return typeof first === "string" ? `${error}: ${first}` : error;
    }
  }
  return status >= 500
    ? "The server isn't responding. Is the backend running?"
    : `Request failed (${status})`;
}

export async function request<T>(
  path: string,
  { method = "GET", body, signal }: RequestOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err; // caller cancelled; not a server problem
    throw new ApiError(0, "Can't reach the server. Is the backend running?");
  }

  if (!res.ok) {
    const parsed: unknown = await res.json().catch(() => null);
    throw new ApiError(res.status, describe(parsed, res.status));
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}
