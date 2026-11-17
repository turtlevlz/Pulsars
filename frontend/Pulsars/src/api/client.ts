import { currentUserId, getSession, setSession } from "./session";

const API_URL = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, "");

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
  /** Send the login token (the default). Sign-in and sign-up have none yet. */
  auth?: boolean;
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
  { method = "GET", body, signal, auth = true }: RequestOptions = {},
): Promise<T> {
  const token = auth ? getSession()?.token : undefined;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err; // caller cancelled; not a server problem
    throw new ApiError(0, "Can't reach the server. Is the backend running?");
  }

  if (!res.ok) {
    // The token expired, was revoked (password change) or the account is gone: sign out, and the
    // router sends the user to the login page. Only if it is still the token this request used,
    // so a slow 401 can't sign out a login that happened in the meantime.
    if (res.status === 401 && token && getSession()?.token === token) setSession(null);
    const parsed: unknown = await res.json().catch(() => null);
    throw new ApiError(res.status, describe(parsed, res.status));
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * A request under the signed-in user's own `/users/:id`, e.g. `requestForUser("/vitals")`.
 * Async, so being signed out is a rejected promise like any other failure, not a throw.
 */
export async function requestForUser<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>(`/users/${currentUserId()}${path}`, options);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}
