import { useState } from "react";
import type { FormEvent } from "react";
import { assignCheckup } from "../../api/medic";
import { errorMessage } from "../../api/client";
import { CHECKUP_TEMPLATES, DUE_CHOICES, dueDate } from "../../lib/medic";
import type { DueChoice } from "../../lib/medic";

type AssignCheckupProps = {
  patient: { id: number; name: string };
  /** Called after the check-up was created, so the page can refresh what it shows. */
  onAssigned: () => void;
};

const CUSTOM = "custom";

/**
 * Assigning a check-up is also what makes a medic follow a patient: from then on the medic can
 * see that patient's vitals, alerts, symptoms and follow-up threads.
 */
export default function AssignCheckup({ patient, onAssigned }: AssignCheckupProps) {
  const [templateId, setTemplateId] = useState<string>(CHECKUP_TEMPLATES[0].id);
  const [customName, setCustomName] = useState("");
  const [customQuestions, setCustomQuestions] = useState("");
  const [due, setDue] = useState<DueChoice>("today");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const template = CHECKUP_TEMPLATES.find((t) => t.id === templateId);
  const name = template ? template.name : customName.trim();
  const questions = template
    ? template.questions
    : customQuestions
        .split("\n")
        .map((q) => q.trim())
        .filter(Boolean);
  const description = [template?.description, instructions.trim()].filter(Boolean).join("\n");
  const ready = name.length > 0 && questions.length > 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      await assignCheckup({
        patientId: patient.id,
        name,
        description: description || undefined,
        dueAt: dueDate(due),
        questions,
      });
      setSent(`"${name}" was sent to ${patient.name}.`);
      setInstructions("");
      onAssigned();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card medic-assign" aria-labelledby="assign-title">
      <h2 id="assign-title" className="card__title card__title--lg">
        Assign a checkup
      </h2>

      <form className="symptom-log__form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field__label">Checkup type</span>
          <select
            className="field__control field__control--select"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            {CHECKUP_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value={CUSTOM}>Custom...</option>
          </select>
        </label>

        {template ? (
          <ol className="medic-assign__questions" aria-label="Questions in this checkup">
            {template.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        ) : (
          <>
            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="field__control"
                type="text"
                maxLength={100}
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Questions (one per line)</span>
              <textarea
                className="field__control field__control--textarea"
                rows={4}
                value={customQuestions}
                onChange={(e) => setCustomQuestions(e.target.value)}
              />
            </label>
          </>
        )}

        <label className="field">
          <span className="field__label">Due</span>
          <select
            className="field__control field__control--select"
            value={due}
            onChange={(e) => setDue(e.target.value as DueChoice)}
          >
            {DUE_CHOICES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Instructions for the patient (optional)</span>
          <textarea
            className="field__control field__control--textarea"
            rows={3}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {sent && (
          <p role="status" className="form-ok">
            {sent}
          </p>
        )}

        <button type="submit" className="btn btn--primary" disabled={!ready || busy}>
          {busy ? "Sending..." : "Send checkup"}
        </button>
      </form>
    </section>
  );
}
