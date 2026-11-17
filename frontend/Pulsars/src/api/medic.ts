import type { CheckupSummary } from "./checkups";
import { request } from "./client";
import type { AlertItem } from "./metrics";
import type { Symptom } from "./symptoms";
import type { VitalType } from "./vitals";

// Everything the medic dashboard reads and writes. The medic only ever gets data for patients
// they have assigned a check-up to; anything else is a 403 from the backend.

export type RosterPatient = {
  id: number;
  name: string;
  age: number | null;
  /** ISO timestamp of the newest reading of any vital, or null if there is none yet. */
  lastReadingAt: string | null;
  /** Health alerts nobody has acknowledged yet (last 7 days). */
  openAlerts: number;
  /** The worst level among them, or null when there are none. */
  openAlertLevel: "red" | "yellow" | null;
};

export type PatientHit = { id: number; name: string };

export function getRoster(signal?: AbortSignal) {
  return request<RosterPatient[]>("/patients/overview", { signal });
}

export function searchPatients(q: string, signal?: AbortSignal) {
  return request<PatientHit[]>(`/patients/search?q=${encodeURIComponent(q)}`, { signal });
}

/** The dashed reference line on a chart (from the backend's metrics config), not an alert limit. */
export type Threshold = { bound: "upper" | "lower"; limit: number; label: string };

/** What is normal for this person at that time: drawn as a shaded band behind the line. */
export type BaselineBand = { t: string; low: number; high: number };

export type TrendPoint = { t: string; avg: number; min: number; max: number };

export type Trend = {
  type: VitalType;
  unit: string;
  from: string;
  to: string;
  bucketSeconds: number;
  /** Null where a single limit would mislead (skin temperature). */
  threshold: Threshold | null;
  /** Null until the person has a baseline, and for blood oxygen. */
  baseline: BaselineBand[] | null;
  /** Oldest first; buckets without readings are left out. */
  points: TrendPoint[];
};

const iso = (d: Date) => encodeURIComponent(d.toISOString());

export function getTrend(patientId: number, type: VitalType, from: Date, to: Date, signal?: AbortSignal) {
  return request<Trend>(
    `/users/${patientId}/vitals/trend?type=${type}&from=${iso(from)}&to=${iso(to)}&points=60`,
    { signal },
  );
}

export type Latest = Record<VitalType, { recordedAt: string; value: number; unit: string } | null>;

export function getLatest(patientId: number, signal?: AbortSignal) {
  return request<Latest>(`/users/${patientId}/vitals/latest`, { signal });
}

export type VitalSummary = {
  unit: string;
  count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
};

export function getSummary(patientId: number, from: Date, to: Date, signal?: AbortSignal) {
  return request<Record<VitalType, VitalSummary>>(
    `/users/${patientId}/vitals/summary?from=${iso(from)}&to=${iso(to)}`,
    { signal },
  );
}

/** One alert: a stretch of time in which one rule was yellow or red, with what to do about it. */
export type Alert = AlertItem & {
  /** Start of the alert; with the rule, this identifies it. */
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  ongoing: boolean;
  status: "open" | "acknowledged";
  acknowledgedAt: string | null;
  acknowledgedBy: { id: number; name: string } | null;
};

export function listAlerts(patientId: number, from: Date, to: Date, signal?: AbortSignal) {
  return request<Alert[]>(`/users/${patientId}/alerts?from=${iso(from)}&to=${iso(to)}`, { signal });
}

export function acknowledgeAlert(patientId: number, alert: Pick<Alert, "ruleId" | "startedAt">) {
  return request<Alert>(`/users/${patientId}/alerts/acknowledge`, {
    method: "POST",
    body: { ruleId: alert.ruleId, startedAt: alert.startedAt },
  });
}

export function listPatientSymptoms(patientId: number, from: Date, to: Date, signal?: AbortSignal) {
  return request<Symptom[]>(
    `/users/${patientId}/symptoms?from=${iso(from)}&to=${iso(to)}&limit=100`,
    { signal },
  );
}

/** For a medic looking at a patient: only the check-ups this medic assigned. */
export function listPatientCheckups(patientId: number, signal?: AbortSignal) {
  return request<CheckupSummary[]>(`/users/${patientId}/checkups?limit=100`, { signal });
}

export type NewCheckup = {
  patientId: number;
  name: string;
  description?: string;
  /** ISO timestamp in the future. */
  dueAt?: string;
  questions: string[];
};

export function assignCheckup({ patientId, ...rest }: NewCheckup) {
  return request<{ id: number }>("/checkups", {
    method: "POST",
    body: { userId: patientId, ...rest },
  });
}
