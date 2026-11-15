import { request, USER_ID } from "./client";

/** hr = heart rate, bt = body temperature, bo = blood oxygen (same codes as the backend). */
export type VitalType = "hr" | "bt" | "bo";

export type Reading = {
  /** ISO timestamp. */
  recordedAt: string;
  value: number;
};

export type VitalSeries = {
  type: VitalType;
  unit: string;
  /** Oldest first. */
  readings: Reading[];
};

/** The most recent `limit` readings of one vital, oldest first. */
export function getSeries(type: VitalType, limit: number, signal?: AbortSignal) {
  return request<VitalSeries>(
    `/users/${USER_ID}/vitals?type=${type}&limit=${limit}`,
    { signal },
  );
}
