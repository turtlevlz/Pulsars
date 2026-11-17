import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { errorMessage } from "../api/client";
import type { PicklistSymptom } from "../api/metrics";
import type { Frequency } from "../api/symptoms";
import "../styles/Metrics.css";

export type SymptomEntry = {
  symptom: string;
  severity: number;
  frequency: Frequency;
  notes: string;
};

type SymptomLogProps = {
  /** May be async. If it throws, the message is shown and the form keeps its values. */
  onSave?: (entry: SymptomEntry) => void | Promise<void>;
  /** The symptom picklist from the backend's metrics config (labels, red flags, hints). */
  picklist?: PicklistSymptom[];
  /** Who to tell about a red-flag symptom. */
  escalateTo?: string;
  /** Shown under the form, e.g. <RecentSymptoms />, which uses up any height the form leaves. */
  footer?: ReactNode;
};

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: "once", label: "Just this once" },
  { value: "daily", label: "Daily" },
  { value: "several_daily", label: "Several times a day" },
  { value: "weekly", label: "Weekly" },
  { value: "constant", label: "Constantly" },
];

// Used until the config arrives (or if it cannot be reached); the backend knows these by name too.
const FALLBACK_PICKLIST: PicklistSymptom[] = [
  "Headache",
  "Dizziness",
  "Nausea / motion sickness",
  "Shortness of breath",
  "Chest pain",
  "Fatigue",
  "Other",
].map((label) => ({ id: label, label, red_flag: label === "Chest pain" }));

const SEVERITY_LEVELS = [1, 2, 3, 4, 5];

export default function SymptomLog({
  onSave,
  picklist,
  escalateTo = "crew medical officer",
  footer,
}: SymptomLogProps) {
  const options = picklist && picklist.length > 0 ? picklist : FALLBACK_PICKLIST;
  const [chosen, setSymptom] = useState(options[0].label);
  // The list can arrive after the form is drawn: never keep a choice that is not in it
  const chosenOption = options.find((o) => o.label === chosen) ?? options[0];
  const symptom = chosenOption.label;
  const [severity, setSeverity] = useState(2);
  const [frequency, setFrequency] = useState<Frequency>("once");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError(null);
    try {
      await onSave?.({ symptom, severity, frequency, notes: notes.trim() });
      setNotes("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card symptom-log" aria-labelledby="symptom-title">
      <h2 id="symptom-title" className="card__title card__title--lg">
        Log a symptom
      </h2>

      <form className="symptom-log__form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field__label">What are you feeling?</span>
          <select
            className="field__control field__control--select"
            value={symptom}
            onChange={(e) => setSymptom(e.target.value)}
          >
            {options.map(({ id, label }) => (
              <option key={id} value={label}>
                {label}
              </option>
            ))}
          </select>
          {chosenOption.red_flag && (
            <span className="symptom-flag symptom-flag--red" role="note">
              Red flag. Tell the {escalateTo} now; do not wait for the follow-up questions.
            </span>
          )}
          {chosenOption.hint && <span className="symptom-flag">{chosenOption.hint}</span>}
        </label>

        <div className="field" role="group" aria-labelledby="severity-label">
          <span id="severity-label" className="field__label">
            How strong is it? (1 mild, 5 severe)
          </span>
          <div className="severity">
            {SEVERITY_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                className={`severity__btn${level === severity ? " severity__btn--selected" : ""}`}
                aria-pressed={level === severity}
                onClick={() => setSeverity(level)}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field__label">How often does it happen?</span>
          <select
            className="field__control field__control--select"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as Frequency)}
          >
            {FREQUENCY_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Notes (optional)</span>
          <textarea
            className="field__control field__control--textarea"
            rows={3}
            placeholder="The assistant may ask follow-up questions after you save."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="btn btn--primary btn--wide"
          disabled={saving}
        >
          {saving ? "Saving..." : "Save to symptom log"}
        </button>
      </form>

      {footer}
    </section>
  );
}