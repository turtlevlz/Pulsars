import { request } from "./client";
import { setSession } from "./session";
import type { Role, Session } from "./session";

/** What POST /auth/login and /auth/register return (the profile has more fields than we keep). */
type AuthResponse = {
  token: string;
  user: { id: number; name: string; email: string; role: Role };
};

function startSession({ token, user }: AuthResponse): Session {
  const session = {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
  setSession(session);
  return session;
}

export async function login(email: string, password: string) {
  const res = await request<AuthResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
    auth: false,
  });
  return startSession(res);
}

/** Self-service sign-up always creates a patient account. */
export async function register(name: string, email: string, password: string) {
  const res = await request<AuthResponse>("/auth/register", {
    method: "POST",
    body: { name, email, password },
    auth: false,
  });
  return startSession(res);
}

export function signOut() {
  setSession(null);
}
