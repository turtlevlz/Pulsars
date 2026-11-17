import { useEffect, useState } from "react";
import { errorMessage } from "../api/client";
import { getSeries } from "../api/vitals";
import type { Reading, VitalType } from "../api/vitals";

const TYPES: VitalType[] = ["hr", "bt", "bo"];
/** Readings arrive over MQTT; until the backend pushes them, the dashboard polls. */
const POLL_MS = 5000;
const TREND_POINTS = 20;

export type VitalSeriesByType = Partial<Record<VitalType, Reading[]>>;

/** The latest readings of every vital (oldest first), refreshed every few seconds. */
export function useVitals() {
  const [series, setSeries] = useState<VitalSeriesByType>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const refresh = async () => {
      try {
        const results = await Promise.all(
          TYPES.map((type) => getSeries(type, TREND_POINTS, controller.signal)),
        );
        setSeries(Object.fromEntries(results.map((r) => [r.type, r.readings])));
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(errorMessage(err)); // keep showing the last good readings
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  return { series, loading, error };
}
