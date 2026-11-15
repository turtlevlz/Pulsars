import type { VitalType } from "../api/vitals";

export type VitalDefinition = {
  id: string;
  type: VitalType;
  label: string;
  unit: string;
  /** Sparkline color. */
  accent: string;
  /** Decimal places shown on the card. */
  decimals: number;
};

/**
 * The vitals shown on the dashboard. The cards show no Low / Normal / High judgement:
 * the wearable's readings are demo-grade and there is no clinical threshold behind them.
 */
export const VITAL_DEFINITIONS: VitalDefinition[] = [
  {
    id: "heart-rate",
    type: "hr",
    label: "Heart Rate",
    unit: "bpm",
    accent: "#3B82F6",
    decimals: 0,
  },
  {
    id: "body-temp",
    type: "bt",
    label: "Body Temp.",
    unit: "°C",
    accent: "#4F46E5",
    decimals: 1,
  },
  {
    id: "blood-oxygen",
    type: "bo",
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
