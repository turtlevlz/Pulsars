import type { MetricId } from "../api/metrics";
import type { VitalType } from "../api/vitals";

export type VitalDefinition = {
  id: string;
  type: VitalType;
  /** The health tier that judges this vital (see the backend's config/metrics.json). */
  metricId: MetricId;
  label: string;
  unit: string;
  /** Sparkline color. */
  accent: string;
  /** Decimal places shown on the card. */
  decimals: number;
};

/**
 * The vitals shown on the dashboard. The big number is the live reading; the tier next to it
 * (green / yellow / red / unknown) comes from the backend's engine, which compares it with the
 * person's own baseline. The tiers are proposals, not NASA limits, and the sensor is wellness-grade.
 */
export const VITAL_DEFINITIONS: VitalDefinition[] = [
  {
    id: "heart-rate",
    type: "hr",
    metricId: "hr_resting",
    label: "Heart Rate",
    unit: "bpm",
    accent: "#3B82F6",
    decimals: 0,
  },
  {
    id: "body-temp",
    type: "bt",
    metricId: "skin_temp",
    label: "Body Temp.",
    unit: "°C",
    accent: "#4F46E5",
    decimals: 1,
  },
  {
    id: "blood-oxygen",
    type: "bo",
    metricId: "spo2",
    label: "Blood Oxygen",
    unit: "%",
    accent: "#4F46E5",
    decimals: 0,
  },
];

/** A reading older than this is shown as stale. The cuff sends about one a second. */
export const STALE_AFTER_MS = 20_000;

/** "just now", "12 s ago", "3 min ago", ... */
export function formatAge(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
