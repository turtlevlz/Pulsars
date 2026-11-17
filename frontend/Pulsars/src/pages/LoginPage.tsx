import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { login, register } from "../api/auth";
import { errorMessage } from "../api/client";
import StarMascot from "../components/StarMascot";
import { useSession } from "../hooks/useSession";
import "../styles/Pulsars.css";

type Mode = "signin" | "signup";

/** Only ever go back to a path inside this app. */
function safeDestination(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//")
    ? from
    : "/";
}

export default function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const { state } = useLocation();

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (or just now): nothing to do here.
  if (session) return <Navigate to={safeDestination(state)} replace />;

  const signup = mode === "signup";

  const switchMode = () => {
    setMode(signup ? "signin" : "signup");
    setError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (signup) await register(name.trim(), email.trim(), password);
      else await login(email.trim(), password);
      navigate(safeDestination(state), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <section className="card auth__card" aria-labelledby="auth-title">
        <div className="auth__brand">
          <StarMascot size={44} />
          <span className="auth__name">Pulsars</span>
        </div>

        <h1 id="auth-title" className="card__title card__title--lg">
          {signup ? "Create your account" : "Sign in"}
        </h1>

        <form className="auth__form" onSubmit={handleSubmit}>
          {signup && (
            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="field__control"
                type="text"
                autoComplete="name"
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}

          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="field__control"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">
              Password{signup ? " (at least 8 characters)" : ""}
            </span>
            <input
              className="field__control"
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              required
              minLength={signup ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Please wait..." : signup ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="auth__switch">
          {signup ? "Already have an account? " : "New here? "}
          <button type="button" className="auth__link" onClick={switchMode}>
            {signup ? "Sign in" : "Create an account"}
          </button>
        </p>
      </section>
    </main>
  );
}
