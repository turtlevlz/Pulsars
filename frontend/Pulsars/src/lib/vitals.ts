import type { VitalStatus } from "../components/VitalCard";
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
  /**
   * Typical resting range for adults, used only to label the card Low / Normal / High.
   * These are display hints, not medical thresholds. Alerting is a later backend phase.
   */
  normal: { min: number; max: number };
};

export const VITAL_DEFINITIONS: VitalDefinition[] = [
  {
    id: "heart-rate",
    type: "hr",
    label: "Heart Rate",
    unit: "bpm",
    accent: "#3B82F6",
    decimals: 0,
    normal: { min: 60, max: 100 },
  },
  {
    id: "body-temp",
    type: "bt",
    label: "Body Temp.",
    unit: "°C",
    accent: "#4F46E5",
    decimals: 1,
    normal: { min: 36.0, max: 37.5 },
  },
  {
    id: "blood-oxygen",
    type: "bo",
    label: "Blood Oxygen",
    unit: "%",
    accent: "#4F46E5",
    decimals: 0,
    normal: { min: 95, max: 100 },
  },
];

export function vitalStatus(
  value: number,
  { min, max }: VitalDefinition["normal"],
): VitalStatus {
  if (value < min) return "Low";
  if (value > max) return "High";
  return "Normal";
}
