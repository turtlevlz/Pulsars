/**
 * Who is signed in, and their login token. Kept in sessionStorage, so it survives a reload but
 * ends when the tab is closed, and mirrored in memory so everything still works when storage is
 * blocked. This is a tiny external store: React reads it through hooks/useSession.ts.
 */
export type Role = "patient" | "medic";

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
};

export type Session = { token: string; user: SessionUser };

const KEY = "pulsars.session";

function isSession(value: unknown): value is Session {
  if (typeof value !== "object" || value === null) return false;
  const { token, user } = value as Partial<Session>;
  return (
    typeof token === "string" &&
    typeof user === "object" &&
    user !== null &&
    Number.isInteger(user.id) &&
    typeof user.name === "string" &&
    typeof user.email === "string" &&
    (user.role === "patient" || user.role === "medic")
  );
}

function load(): Session | null {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    return isSession(parsed) ? parsed : null;
  } catch {
    return null; // nothing stored, unreadable, or storage unavailable
  }
}

let current: Session | null = load();
const listeners = new Set<() => void>();

export const getSession = () => current;

/** Signs in (a session) or out (null). */
export function setSession(session: Session | null) {
  current = session;
  try {
    if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage is blocked; the in-memory copy still works for this page load
  }
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The signed-in user's id, for the `/users/:id/...` endpoints. */
export function currentUserId(): number {
  if (!current) throw new Error("You're signed out. Sign in again.");
  return current.user.id;
}
