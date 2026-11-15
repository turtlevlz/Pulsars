import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../api/client";
import {
  getLatest,
  getSummary,
  getTrend,
  listAlerts,
  listPatientCheckups,
  listPatientSymptoms,
} from "../api/medic";
import type { Alert, Latest, Trend, VitalSummary } from "../api/medic";
import type { CheckupSummary } from "../api/checkups";
import type { Symptom } from "../api/symptoms";
import type { VitalType } from "../api/vitals";
import { rangeById } from "../lib/medic";
import type { RangeId } from "../lib/medic";

const POLL_MS = 15_000;
const TYPES: VitalType[] = ["hr", "bt", "bo"];

export type PatientData = {
  trends: Record<VitalType, Trend>;
  latest: Latest;
  summary: Record<VitalType, VitalSummary>;
  previous: Record<VitalType, VitalSummary>;
  alerts: Alert[];
  symptoms: Symptom[];
  checkups: CheckupSummary[];
  /** When this was fetched (ms). */
  fetchedAt: number;
};

type Loaded = { key: string; data: PatientData };

/**
 * Everything the medic dashboard shows for one patient over one range, refreshed every 15 s.
 * Pass `null` for no patient (nothing is fetched). `reload()` fetches again right away.
 */
export function usePatientDashboard(patientId: number | null, range: RangeId) {
  const key = `${patientId}|${range}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (patientId === null) return;
    const controller = new AbortController();
    const { signal } = controller;

    const refresh = async () => {
      const to = new Date();
      const from = new Date(to.getTime() - rangeById(range).ms);
      const before = new Date(from.getTime() - rangeById(range).ms);
      try {
        const [trendList, latest, summary, previous, alerts, symptoms, checkups] = await Promise.all([
          Promise.all(TYPES.map((t) => getTrend(patientId, t, from, to, signal))),
          getLatest(patientId, signal),
          getSummary(patientId, from, to, signal),
          getSummary(patientId, before, new Date(from.getTime() - 1), signal),
          listAlerts(patientId, from, to, signal),
          listPatientSymptoms(patientId, from, to, signal),
          listPatientCheckups(patientId, signal),
        ]);
        const trends = Object.fromEntries(trendList.map((t) => [t.type, t])) as Record<VitalType, Trend>;
        setLoaded({
          key,
          data: { trends, latest, summary, previous, alerts, symptoms, checkups, fetchedAt: to.getTime() },
        });
        setFailure(null);
      } catch (err) {
        if (signal.aborted) return;
        setFailure({ key, message: errorMessage(err) }); // keep showing the last good data
      }
    };

    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [patientId, range, key, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  // Data fetched for another patient or range is never shown for this one.
  const data = loaded && loaded.key === key ? loaded.data : null;
  const error = failure && failure.key === key ? failure.message : null;
  return { data, error, loading: patientId !== null && data === null && error === null, reload };
}
