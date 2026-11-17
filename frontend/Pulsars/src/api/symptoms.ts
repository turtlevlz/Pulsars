import type { SymptomEntry } from "../components/SymptomLog";
import type { SymptomRecord } from "../components/SymptomHistory";
import { requestForUser } from "./client";

export type Frequency =
  | "once"
  | "daily"
  | "several_daily"
  | "weekly"
  | "constant";

export type Symptom = {
  id: number;
  name: string;
  /** 1 (mild) to 5 (severe). */
  intensity: number;
  frequency: Frequency;
  notes: string | null;
  /** ISO timestamp. */
  loggedAt: string;
};

/** Logging a symptom also opens a follow-up thread; null if the backend couldn't. */
export type CreatedSymptom = Symptom & { threadId: number | null };

export function createSymptom({ symptom, severity, frequency, notes }: SymptomEntry) {
  return requestForUser<CreatedSymptom>("/symptoms", {
    method: "POST",
    body: {
      name: symptom,
      intensity: severity,
      frequency,
      // The backend accepts omitted notes but not a pointless empty string.
      ...(notes ? { notes } : {}),
    },
  });
}

/** Newest first. */
export function listSymptoms(signal?: AbortSignal, limit = 50) {
  return requestForUser<Symptom[]>(`/symptoms?limit=${limit}`, { signal });
}

export function symptomToRecord(symptom: Symptom): SymptomRecord {
  return {
    id: String(symptom.id),
    symptom: symptom.name,
    severity: symptom.intensity,
    notes: symptom.notes ?? "",
    loggedAt: symptom.loggedAt,
  };
}
