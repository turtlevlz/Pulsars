import { useState } from "react";
import { createLog } from "../../api/metrics";
import { formatHours, fromLocalInput, toLocalInput } from "../../lib/logs";
import LogFormShell from "./LogFormShell";

const QUALITY = [1, 2, 3, 4, 5];

export default function SleepForm({ onSaved }: { onSaved: () => void }) {
  // Last night, about eight hours, ending now: a starting point to correct, not a guess to keep
  const [bedtime, setBedtime] = useState(() => toLocalInput(new Date(Date.now() - 8 * 3600_000)));
  const [wake, setWake] = useState(() => toLocalInput(new Date()));
  const [quality, setQuality] = useState<number | null>(null);

  const start = fromLocalInput(bedtime);
  const end = fromLocalInput(wake);
  const slept = start && end && end > start ? formatHours(end.getTime() - start.getTime()) : null;

  const save = async () => {
    if (!start || !end) throw new Error("Enter when you went to bed and when you woke up.");
    await createLog("sleep", {
      bedtime: start.toISOString(),
      wakeTime: end.toISOString(),
      ...(quality !== null ? { quality } : {}),
    });
    setQuality(null);
    onSaved();
  };

  return (
    <LogFormShell submitLabel="Save sleep" onSubmit={save}>
      <label className="field">
        <span className="field__label">Went to bed</span>
        <input className="field__control" type="datetime-local" value={bedtime} onChange={(e) => setBedtime(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Woke up</span>
        <input className="field__control" type="datetime-local" value={wake} onChange={(e) => setWake(e.target.value)} />
      </label>
      <p className="log-form__hint">{slept ? `That is ${slept} of sleep.` : "Wake-up must be after bedtime."}</p>

      <div className="field" role="group" aria-labelledby="sleep-quality-label">
        <span id="sleep-quality-label" className="field__label">
          How well did you sleep? (optional, 1 poor, 5 great)
        </span>
        <div className="severity">
          {QUALITY.map((level) => (
            <button
              key={level}
              type="button"
              className={`severity__btn${level === quality ? " severity__btn--selected" : ""}`}
              aria-pressed={level === quality}
              onClick={() => setQuality(level === quality ? null : level)}
            >
              {level}
            </button>
          ))}
        </div>
      </div>
    </LogFormShell>
  );
}
