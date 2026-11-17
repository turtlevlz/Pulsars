import type { LogEntry, LogSymptom } from "../api/metrics";

// Helpers for the manual health logs (blood pressure, sleep, ...): reading numbers out of form
// fields, the local date-time inputs, and one plain sentence per saved entry.

/** A whole-number form field: null when it is blank or not a number. */
export function wholeNumber(text: string): number | null {
  const n = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(n) ? n : null;
}

/** A decimal form field: null when it is blank or not a number. */
export function decimalNumber(text: string): number | null {
  const n = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(n) ? n : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The value format of an `<input type="datetime-local">` (local time, to the minute). */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The moment a datetime-local value stands for, or null when it is blank or unreadable. */
export function fromLocalInput(text: string): Date | null {
  if (text === "") return null;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The time to send for a "When was it?" field, or undefined for "now". */
export const whenOrNow = (value: string) => fromLocalInput(value) ?? undefined;

/** Mean arterial pressure, the way the backend works it out (diastolic plus a third of the pulse pressure). */
export const meanArterialPressure = (systolic: number, diastolic: number) =>
  Math.round((diastolic + (systolic - diastolic) / 3) * 10) / 10;

export function formatHours(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function formatLogTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const LOG_KIND_LABEL = {
  bp: "Blood pressure",
  sleep: "Sleep",
  core_temp: "Core temperature",
  exercise: "Exercise",
  orthostatic: "Standing test",
} as const;

const POSTURE_LABEL = { supine: "lying", seated: "seated", standing: "standing" } as const;

/** One line that says what was logged, with the labels of any symptoms ticked. */
export function describeLog(entry: LogEntry, symptoms: LogSymptom[]): string {
  const label = (id: string) => symptoms.find((s) => s.id === id)?.label.toLowerCase() ?? id.replace(/_/g, " ");
  switch (entry.kind) {
    case "bp": {
      const v = (entry as LogEntry<"bp">).value;
      const map = (entry as LogEntry<"bp">).derived?.map;
      const parts = [
        `${v.systolic}/${v.diastolic} mmHg`,
        map !== undefined ? `MAP ${map}` : null,
        `pulse ${v.heartRate}`,
        POSTURE_LABEL[v.posture],
        v.restedFiveMinutes && v.armAtHeartLevel ? null : "technique not confirmed",
        v.symptoms.length > 0 ? `with ${v.symptoms.map(label).join(", ")}` : null,
      ];
      return parts.filter(Boolean).join(", ");
    }
    case "sleep": {
      const v = (entry as LogEntry<"sleep">).value;
      const slept = formatHours(Date.parse(v.wakeTime) - Date.parse(v.bedtime));
      return v.quality !== undefined ? `${slept}, quality ${v.quality}/5` : slept;
    }
    case "core_temp": {
      const v = (entry as LogEntry<"core_temp">).value;
      return `${v.celsius.toFixed(1)} °C (${v.site})`;
    }
    case "exercise": {
      const v = (entry as LogEntry<"exercise">).value;
      if (!v.done) return "No exercise";
      return v.minutes !== undefined ? `Exercised, ${v.minutes} min` : "Exercised";
    }
    case "orthostatic": {
      const v = (entry as LogEntry<"orthostatic">).value;
      const at = (s: { systolic: number; diastolic: number; heartRate: number }) =>
        `${s.systolic}/${s.diastolic}, pulse ${s.heartRate}`;
      const parts = [
        `lying ${at(v.supine)}`,
        `standing 1 min ${at(v.standing1)}`,
        `3 min ${at(v.standing3)}`,
        v.symptoms.length > 0 ? `with ${v.symptoms.map(label).join(", ")}` : null,
      ];
      return parts.filter(Boolean).join("; ");
    }
  }
}
