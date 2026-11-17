import type { MotionLevel } from "../api/fitness";

export const levelLabels: Record<MotionLevel, string> = {
  light: "Light",
  moderate: "Moderate",
  high: "High",
};

export function dateKey(now: Date) {
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(part => String(part).padStart(2, "0")).join("-");
}

export function civilDate(date: string) {
  return new Date(`${date}T12:00:00Z`);
}

export function shiftMonth(month: string, by: number) {
  const first = civilDate(`${month}-01`);
  first.setUTCMonth(first.getUTCMonth() + by);
  return first.toISOString().slice(0, 7);
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function formatDuration(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value / 60) % 60;
  const secondsPart = value % 60;
  const units = [hours && `${hours} h`, minutes && `${minutes} min`, secondsPart && `${secondsPart} s`];
  return units.filter(Boolean).join(" ") || "0 s";
}
