import { useState } from "react";
import { createLog } from "../../api/metrics";
import type { LogSymptom } from "../../api/metrics";
import { whenOrNow, wholeNumber } from "../../lib/logs";
import LogFormShell from "./LogFormShell";
import SymptomChecks from "./SymptomChecks";
import WhenField from "./WhenField";

type Reading = { sys: string; dia: string; hr: string };
const EMPTY: Reading = { sys: "", dia: "", hr: "" };

const STEPS = [
  { key: "supine", label: "1. Lying down for 5 minutes" },
  { key: "standing1", label: "2. After standing for 1 minute" },
  { key: "standing3", label: "3. After standing for 3 minutes" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

/** The standing test: only offered where there is gravity (the backend refuses it on a station). */
export default function OrthostaticForm({ symptoms, onSaved }: { symptoms: LogSymptom[]; onSaved: () => void }) {
  const [readings, setReadings] = useState<Record<StepKey, Reading>>({
    supine: EMPTY,
    standing1: EMPTY,
    standing3: EMPTY,
  });
  const [ticked, setTicked] = useState<string[]>([]);
  const [when, setWhen] = useState("");

  const set = (key: StepKey, field: keyof Reading, value: string) =>
    setReadings((r) => ({ ...r, [key]: { ...r[key], [field]: value } }));

  const save = async () => {
    const parsed = STEPS.map(({ key }) => {
      const r = readings[key];
      return { systolic: wholeNumber(r.sys), diastolic: wholeNumber(r.dia), heartRate: wholeNumber(r.hr) };
    });
    if (parsed.some((p) => p.systolic === null || p.diastolic === null || p.heartRate === null)) {
      throw new Error("Fill in all three readings (top, bottom and pulse) as whole numbers.");
    }
    const [supine, standing1, standing3] = parsed as {
      systolic: number;
      diastolic: number;
      heartRate: number;
    }[];
    await createLog("orthostatic", { supine, standing1, standing3, symptoms: ticked }, whenOrNow(when));
    setReadings({ supine: EMPTY, standing1: EMPTY, standing3: EMPTY });
    setTicked([]);
    setWhen("");
    onSaved();
  };

  return (
    <LogFormShell submitLabel="Save standing test" onSubmit={save}>
      {STEPS.map(({ key, label }) => (
        <fieldset key={key} className="field">
          <legend className="field__label">{label}</legend>
          <div className="log-form__row">
            {(["sys", "dia", "hr"] as const).map((field) => (
              <input
                key={field}
                className="field__control"
                inputMode="numeric"
                aria-label={`${label}: ${field === "sys" ? "top pressure" : field === "dia" ? "bottom pressure" : "pulse"}`}
                placeholder={field === "sys" ? "top" : field === "dia" ? "bottom" : "pulse"}
                value={readings[key][field]}
                onChange={(e) => set(key, field, e.target.value)}
              />
            ))}
          </div>
        </fieldset>
      ))}
      <SymptomChecks
        legend="Did you feel any of these when you stood up?"
        options={symptoms}
        selected={ticked}
        onChange={setTicked}
      />
      <WhenField value={when} onChange={setWhen} />
    </LogFormShell>
  );
}
