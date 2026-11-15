import { useState } from "react";
import type { FormEvent } from "react";

export type SymptomEntry = {
  symptom: string;
  severity: number;
  notes: string;
};

type SymptomLogProps = {
  onSave?: (entry: SymptomEntry) => void;
  symptoms?: string[];
};

const DEFAULT_SYMPTOMS = [
  "Headache",
  "Fatigue",
  "Dizziness",
  "Nausea",
  "Shortness of breath",
  "Chest discomfort",
  "Fever",
  "Other",
];

const SEVERITY_LEVELS = [1, 2, 3, 4, 5];

export default function SymptomLog({
  onSave,
  symptoms = DEFAULT_SYMPTOMS,
}: SymptomLogProps) {
  const [symptom, setSymptom] = useState(symptoms[0]);
  const [severity, setSeverity] = useState(2);
  const [notes, setNotes] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSave?.({ symptom, severity, notes: notes.trim() });
    setNotes("");
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
            {symptoms.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
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
          <span className="field__label">Notes (optional)</span>
          <textarea
            className="field__control field__control--textarea"
            rows={3}
            placeholder="The assistant may ask follow-up questions after you save."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <button type="submit" className="btn btn--primary btn--wide">
          Save to symptom log
        </button>
      </form>
    </section>
  );
}