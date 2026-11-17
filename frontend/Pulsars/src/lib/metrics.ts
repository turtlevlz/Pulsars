import type { EvidenceLevel, Level, MetricId, MetricStatus } from "../api/metrics";

// Words and glyphs for the tiers. A tier is never colour alone: each has a word and a shape.
export const LEVEL_LABEL: Record<Level, string> = {
  green: "Green",
  yellow: "Yellow",
  red: "Red",
  gray: "Unknown",
};

export const LEVEL_GLYPH: Record<Level, string> = {
  green: "●",
  yellow: "▲",
  red: "■",
  gray: "○",
};

export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  NASA_STANDARD: "NASA standard",
  CLINICAL_GUIDELINE: "Clinical guideline",
  SPACEFLIGHT_DATA: "Spaceflight data",
  OUR_HEURISTIC: "Our heuristic",
};

export const EVIDENCE_HINT: Record<EvidenceLevel, string> = {
  NASA_STANDARD: "Based on a published NASA standard.",
  CLINICAL_GUIDELINE: "Based on a clinical guideline. The tier cut-offs built on it are our own proposal, not NASA limits.",
  SPACEFLIGHT_DATA: "Based on spaceflight studies. The tier cut-offs are our own proposal, not NASA limits.",
  OUR_HEURISTIC: "Our own proposed tier, built from clinical conventions and spaceflight studies. Not a NASA limit.",
};

/** Sensor metrics and the vital each is drawn from. */
export const SENSOR_METRIC: Record<"hr" | "bt" | "bo", MetricId> = {
  hr: "hr_resting",
  bt: "skin_temp",
  bo: "spo2",
};

export const isMetricId = (value: string | undefined): value is MetricId =>
  value !== undefined &&
  ["hr_resting", "skin_temp", "spo2", "bp", "sleep", "orthostatic", "symptoms"].includes(value);

/** Yellow and red first, red before yellow; the rest in their given order. */
export function worstFirst<T extends { level: Level }>(items: T[]): T[] {
  const rank: Record<Level, number> = { red: 0, yellow: 1, green: 2, gray: 3 };
  return [...items].sort((a, b) => rank[a.level] - rank[b.level]);
}

/** "3 min ago" for the data age of a tier, or "no data". */
export function ageText(status: Pick<MetricStatus, "ageMinutes">): string {
  const m = status.ageMinutes;
  if (m === null) return "no data yet";
  if (m < 1) return "just now";
  if (m < 90) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}
