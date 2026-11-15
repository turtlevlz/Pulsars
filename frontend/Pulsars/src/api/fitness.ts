import { requestForUser } from "./client";

export const MOTION_LEVELS = ["light", "moderate", "high"] as const;
export type MotionLevel = typeof MOTION_LEVELS[number];
export type Intensity = Record<MotionLevel, number>;

export type ActivityTotals = {
  date: string;
  trackedSeconds: number;
  activeSeconds: number;
  intensity: Intensity;
};

export type TimedReading = { value: number; recordedAt: string; relation: "during" | "before" | "after" };
type Interval = { startedAt: string; endedAt: string };
type Readings = { pulse: TimedReading | null; skinTemperature: TimedReading | null };

export type TimelineEvent =
  | (Interval & Readings & { kind: "activity"; band: MotionLevel; activeSeconds: number; intensity: Intensity })
  | (Interval & Readings & { kind: "quiet"; gapSeconds: number })
  | (Interval & { kind: "gap" })
  | { kind: "routine"; routineKey: string; title: string; completedAt: string };

export type FitnessDay = ActivityTotals & { lastReadingAt: string | null; timeline: TimelineEvent[] };
export type FitnessCalendar = { month: string; days: ActivityTotals[] };
export type Routine = {
  key: string;
  title: string;
  category: string;
  duration: string;
  steps: string[];
  completedAt: string | null;
};
export type Routines = { date: string; routines: Routine[] };

// Everything here is under the signed-in patient's own /users/:id/fitness.
const base = "/fitness";

export function getCalendar(month: string, timeZone: string, signal: AbortSignal) {
  return requestForUser<FitnessCalendar>(`${base}/calendar?${new URLSearchParams({ month, timeZone })}`, { signal });
}

export function getDay(date: string, timeZone: string, signal: AbortSignal) {
  return requestForUser<FitnessDay>(`${base}/day?${new URLSearchParams({ date, timeZone })}`, { signal });
}

export function getRoutines(timeZone: string, signal: AbortSignal) {
  return requestForUser<Routines>(`${base}/routines?${new URLSearchParams({ timeZone })}`, { signal });
}

export function finishRoutine(key: string, timeZone: string) {
  return requestForUser<{ date: string; key: string; completedAt: string }>(
    `${base}/routines/${encodeURIComponent(key)}/completion`,
    { method: "PUT", body: { timeZone } },
  );
}
