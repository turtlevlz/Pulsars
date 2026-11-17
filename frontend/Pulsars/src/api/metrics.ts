import { request, requestForUser } from "./client";

// The health-metrics engine's side of the API (backend: modules/metrics, modules/logs). All the
// thresholds live in the backend's config/metrics.json; this app reads them from
// GET /metrics/config and never keeps its own copy.

export type Level = "green" | "yellow" | "red" | "gray";

export type EvidenceLevel =
  | "NASA_STANDARD"
  | "CLINICAL_GUIDELINE"
  | "SPACEFLIGHT_DATA"
  | "OUR_HEURISTIC";

export type MetricId =
  | "hr_resting"
  | "skin_temp"
  | "spo2"
  | "bp"
  | "sleep"
  | "orthostatic"
  | "symptoms";

export type MetricConfig = {
  metric_id: MetricId;
  title: string;
  input: "sensor" | "log";
  /** The vital this is charted from (sensor metrics only). */
  vital?: "hr" | "bt" | "bo";
  unit: string;
  baseline_rule: string;
  tiers: { green: string; yellow: string; red: string };
  persistence: string;
  evidence_level: EvidenceLevel;
  evidence_note: string;
  sources: string[];
  limitation: string;
  action: { yellow: string; red: string };
  stale_after_minutes: number;
  requires_gravity?: boolean;
  explain: { how: string; meaning: string; why: string };
};

export type Profile = { id: string; label: string; gravity: boolean; note: string };

export type PicklistSymptom = { id: string; label: string; red_flag: boolean; hint?: string };
export type LogSymptom = { id: string; label: string; effect: "red" | "presyncope" };

export type MetricsConfig = {
  disclaimer: string;
  profiles: Profile[];
  default_profile: string;
  escalate_to: string;
  chart_limits: Record<"hr" | "bt" | "bo", { bound: "upper" | "lower"; limit: number; label: string } | null>;
  metrics: MetricConfig[];
  symptoms: PicklistSymptom[];
  log_symptoms: LogSymptom[];
  rules: { id: string; title: string; active: boolean; when: string; inactive_reason?: string }[];
};

export function getMetricsConfig(signal?: AbortSignal) {
  return request<MetricsConfig>("/metrics/config", { signal });
}

export type MetricStatus = {
  metricId: MetricId;
  title: string;
  level: Level;
  /** One plain sentence on why this tier. */
  reason: string;
  value: number | null;
  /** The value as written for a person, e.g. "118/76 mmHg, MAP 90". */
  display: string | null;
  unit: string;
  /** ISO time of the end of the reading the tier rests on. */
  measuredAt: string | null;
  ageMinutes: number | null;
  baseline: { value: number | null; label: string } | null;
  quality: { motionArtifact: boolean | null; coverage: number | null; note: string | null };
  flags: string[];
  evidenceLevel: EvidenceLevel;
  /** What to do now (yellow and red only). */
  action: string | null;
  detail: Record<string, unknown> | null;
};

export type AlertItem = {
  ruleId: string;
  kind: "metric" | "rule";
  title: string;
  level: "yellow" | "red";
  reason: string;
  recommendedAction: string;
  escalateTo: string | null;
  evidenceLevel: EvidenceLevel;
};

export type MetricStatusResponse = {
  evaluatedAt: string;
  profile: { id: string; label: string; gravity: boolean };
  disclaimer: string;
  metrics: MetricStatus[];
  rules: { ruleId: string; title: string; level: Level; reason: string }[];
  alerts: AlertItem[];
};

/** The tiers of one patient; a patient's own when `patientId` is left out. */
export function getMetricStatus(patientId?: number, signal?: AbortSignal) {
  return patientId === undefined
    ? requestForUser<MetricStatusResponse>("/metrics/status", { signal })
    : request<MetricStatusResponse>(`/users/${patientId}/metrics/status`, { signal });
}

// ------------------------------------------------------------------ manual logs

export type LogKind = "bp" | "sleep" | "core_temp" | "exercise" | "orthostatic";
export type Posture = "supine" | "seated" | "standing";

export type BpValue = {
  systolic: number;
  diastolic: number;
  heartRate: number;
  posture: Posture;
  restedFiveMinutes: boolean;
  armAtHeartLevel: boolean;
  symptoms: string[];
};
export type SleepValue = { bedtime: string; wakeTime: string; quality?: number };
export type CoreTempValue = { celsius: number; site: "oral" | "core" | "tympanic" | "other" };
export type ExerciseValue = { done: boolean; minutes?: number };
type Standing = { systolic: number; diastolic: number; heartRate: number };
export type OrthostaticValue = { supine: Standing; standing1: Standing; standing3: Standing; symptoms: string[] };

type LogValues = {
  bp: BpValue;
  sleep: SleepValue;
  core_temp: CoreTempValue;
  exercise: ExerciseValue;
  orthostatic: OrthostaticValue;
};

export type LogEntry<K extends LogKind = LogKind> = {
  id: number;
  kind: K;
  /** ISO timestamp. */
  recordedAt: string;
  value: LogValues[K];
  /** Blood pressure only. */
  derived?: { map: number };
};

export function createLog<K extends LogKind>(kind: K, value: LogValues[K], recordedAt?: Date) {
  return requestForUser<LogEntry<K>>("/logs", {
    method: "POST",
    // a night is recorded at the moment of waking, so it carries no separate time
    body: { kind, value, ...(recordedAt && kind !== "sleep" ? { recordedAt: recordedAt.toISOString() } : {}) },
  });
}

/** Newest first. */
export function listLogs(kind: LogKind | undefined, limit: number, offset = 0, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (kind) query.set("kind", kind);
  return requestForUser<LogEntry[]>(`/logs?${query}`, { signal });
}

/** Where the person is; decides which checks are on (the orthostatic check needs gravity). */
export function setEnvironmentProfile(userId: number, environmentProfile: string) {
  return request<{ id: number; environmentProfile: string }>(`/users/${userId}`, {
    method: "PATCH",
    body: { environmentProfile },
  });
}
