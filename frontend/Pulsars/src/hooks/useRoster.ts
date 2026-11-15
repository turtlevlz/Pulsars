import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../api/client";
import { getRoster } from "../api/medic";
import type { RosterPatient } from "../api/medic";

const POLL_MS = 30_000;

/** The medic's patients with their latest reading and open alert count, refreshed every 30 s. */
export function useRoster() {
  const [patients, setPatients] = useState<RosterPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    const refresh = async () => {
      try {
        setPatients(await getRoster(controller.signal));
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(errorMessage(err)); // keep showing the last good list
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
  }, [tick]);

  /** Fetch again now (after acknowledging an alert or assigning a first check-up). */
  const reload = useCallback(() => setTick((n) => n + 1), []);

  return { patients, loading, error, reload };
}
