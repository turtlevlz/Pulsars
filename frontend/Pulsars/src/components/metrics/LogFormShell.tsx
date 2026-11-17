import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { errorMessage } from "../../api/client";
import "../../styles/Metrics.css";

type LogFormShellProps = {
  children: ReactNode;
  submitLabel: string;
  /** Throws on failure (the message is shown and the fields keep their values). */
  onSubmit: () => Promise<void>;
};

/** The save button, the error and the "Saved" note that every log form shares. */
export default function LogFormShell({ children, submitLabel, onSubmit }: LogFormShellProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSubmit();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="log-form" onSubmit={handleSubmit}>
      {children}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="log-form__saved">
          Saved.
        </p>
      )}
      <button type="submit" className="btn btn--primary btn--wide" disabled={saving}>
        {saving ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
