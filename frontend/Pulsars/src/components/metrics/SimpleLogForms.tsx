import { useState } from "react";
import { createLog } from "../../api/metrics";
import type { CoreTempValue } from "../../api/metrics";
import { decimalNumber, whenOrNow, wholeNumber } from "../../lib/logs";
import LogFormShell from "./LogFormShell";
import WhenField from "./WhenField";

const SITES: { value: CoreTempValue["site"]; label: string }[] = [
  { value: "oral", label: "Under the tongue (oral)" },
  { value: "tympanic", label: "Ear (tympanic)" },
  { value: "core", label: "Core probe" },
  { value: "other", label: "Other" },
];

/** A thermometer reading. The band's skin temperature can only ask for this; it never makes red by itself. */
export function CoreTempForm({ onSaved }: { onSaved: () => void }) {
  const [celsius, setCelsius] = useState("");
  const [site, setSite] = useState<CoreTempValue["site"]>("oral");
  const [when, setWhen] = useState("");

  const save = async () => {
    const value = decimalNumber(celsius);
    if (value === null) throw new Error("Enter the temperature in degrees Celsius, for example 37.2.");
    await createLog("core_temp", { celsius: value, site }, whenOrNow(when));
    setCelsius("");
    setWhen("");
    onSaved();
  };

  return (
    <LogFormShell submitLabel="Save temperature" onSubmit={save}>
      <label className="field">
        <span className="field__label">Temperature (°C)</span>
        <input
          className="field__control"
          inputMode="decimal"
          placeholder="37.0"
          value={celsius}
          onChange={(e) => setCelsius(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Where did you measure?</span>
        <select
          className="field__control field__control--select"
          value={site}
          onChange={(e) => setSite(e.target.value as CoreTempValue["site"])}
        >
          {SITES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <WhenField value={when} onChange={setWhen} />
    </LogFormShell>
  );
}

export function ExerciseForm({ onSaved }: { onSaved: () => void }) {
  const [done, setDone] = useState(true);
  const [minutes, setMinutes] = useState("");
  const [when, setWhen] = useState("");

  const save = async () => {
    const mins = minutes.trim() === "" ? undefined : wholeNumber(minutes);
    if (mins === null) throw new Error("Enter the minutes as a whole number, or leave it blank.");
    await createLog("exercise", { done, ...(done && mins !== undefined ? { minutes: mins } : {}) }, whenOrNow(when));
    setMinutes("");
    setWhen("");
    onSaved();
  };

  return (
    <LogFormShell submitLabel="Save exercise" onSubmit={save}>
      <div className="check-grid">
        <label className="check">
          <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
          <span>I exercised</span>
        </label>
      </div>
      {done && (
        <label className="field">
          <span className="field__label">How many minutes? (optional)</span>
          <input
            className="field__control"
            inputMode="numeric"
            placeholder="minutes"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
      )}
      <WhenField value={when} onChange={setWhen} />
    </LogFormShell>
  );
}
