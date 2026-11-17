import { useEffect, useState } from "react";
import type { SymptomRecord } from "../components/SymptomHistory";
import { listSymptoms, symptomToRecord } from "../api/symptoms";
import type { Symptom } from "../api/symptoms";

/** The latest few symptom entries, for the dashboard's "Recent entries" strip. */
export function useRecentSymptoms(limit = 12) {
  const [records, setRecords] = useState<SymptomRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    listSymptoms(controller.signal, limit)
      .then((rows) => setRecords(rows.map(symptomToRecord)))
      // The strip is a nicety: if it can't load it stays empty rather than raising a banner.
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [limit]);

  /** Puts a just-saved entry at the top without another request. */
  const add = (created: Symptom) =>
    setRecords((prev) => [symptomToRecord(created), ...prev].slice(0, limit));

  return { records, loading, add };
}
