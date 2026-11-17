import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../api/client";
import { getMetricStatus } from "../api/metrics";
import type { MetricStatusResponse } from "../api/metrics";

const POLL_MS = 10_000;

type Loaded = { key: string; data: MetricStatusResponse };

/**
 * The health tiers of a patient (the signed-in patient's own when `patientId` is left out),
 * refreshed every 10 s. `reload()` fetches again right away, e.g. after a new log entry.
 */
export function useMetricStatus(patientId?: number) {
  const key = String(patientId ?? "me");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const data = await getMetricStatus(patientId, controller.signal);
        setLoaded({ key, data });
        setFailure(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setFailure({ key, message: errorMessage(err) }); // keep showing the last good tiers
      }
    };
    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [patientId, key, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const status = loaded && loaded.key === key ? loaded.data : null;
  const error = failure && failure.key === key ? failure.message : null;
  return { status, error, loading: status === null && error === null, reload };
}
