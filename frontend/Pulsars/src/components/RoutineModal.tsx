import { useId, useState, type FormEvent } from "react";
import { errorMessage } from "../api/client";
import type { Routine } from "../api/fitness";
import Modal from "./Modal";

type Props = { routine: Routine; onClose: () => void; onComplete: (key: string) => Promise<void> };

export default function RoutineModal({ routine, onClose, onComplete }: Props) {
  const titleId = useId();
  const [checked, setChecked] = useState(() => routine.steps.map(() => false));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = checked.every(Boolean);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onComplete(routine.key);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} dismissOnBackdrop={false}>
      <form className="modal__panel" onSubmit={submit}>
        <header className="modal__header">
          <div>
            <h2 id={titleId} className="modal__title">{routine.title}</h2>
            <p className="modal__meta">{routine.category} · {routine.duration}</p>
          </div>
          <button type="button" className="modal__close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="modal__body">
          <fieldset className="fitness-checklist" aria-label="Routine steps" disabled={saving}>
            {routine.steps.map((step, index) => (
              <label key={step}>
                <input type="checkbox" checked={checked[index]}
                  onChange={event => {
                    const value = event.currentTarget.checked;
                    setChecked(current => current.map((item, i) => i === index ? value : item));
                  }} />
                <span>{step}</span>
              </label>
            ))}
          </fieldset>
          {error && <p role="alert" className="notice">{error}</p>}
        </div>
        <footer className="modal__footer">
          <button type="submit" className="btn btn--primary fitness-checklist__submit" disabled={!ready || saving}>
            {saving ? "Saving…" : "Mark complete for today"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
