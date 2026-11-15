import type { CheckupSummary } from "./checkups";
import { request } from "./client";
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
  /** Threshold alerts nobody has acknowledged yet (last 7 days). */
  openAlerts: number;
};

export type PatientHit = { id: number; name: string };

export function getRoster(signal?: AbortSignal) {
  return request<RosterPatient[]>("/patients/overview", { signal });
}

export function searchPatients(q: string, signal?: AbortSignal) {
  return request<PatientHit[]>(`/patients/search?q=${encodeURIComponent(q)}`, { signal });
}

export type Threshold = { bound: "upper" | "lower"; limit: number };

export type TrendPoint = { t: string; avg: number; min: number; max: number };

export type Trend = {
  type: VitalType;
  unit: string;
  from: string;
  to: string;
  bucketSeconds: number;
  threshold: Threshold;
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

export type Alert = {
  type: VitalType;
  unit: string;
  threshold: Threshold;
  /** Start of the first minute past the limit; with the type, this identifies the alert. */
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  /** The worst minute average (highest for an upper limit, lowest for a lower one). */
  peak: number;
  ongoing: boolean;
  status: "open" | "acknowledged";
  acknowledgedAt: string | null;
  acknowledgedBy: { id: number; name: string } | null;
};

export function listAlerts(patientId: number, from: Date, to: Date, signal?: AbortSignal) {
  return request<Alert[]>(`/users/${patientId}/alerts?from=${iso(from)}&to=${iso(to)}`, { signal });
}

export function acknowledgeAlert(patientId: number, alert: Pick<Alert, "type" | "startedAt">) {
  return request<Alert>(`/users/${patientId}/alerts/acknowledge`, {
    method: "POST",
    body: { type: alert.type, startedAt: alert.startedAt },
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
