import { useEffect, useRef, useState } from "react";
import type { Checkup } from "../components/Checkups";
import type { CheckupAnswers } from "../lib/questionnaire";
import {
  getCheckup,
  listCheckups,
  sortCheckups,
  submitAnswers,
  toCheckup,
} from "../api/checkups";
import { errorMessage } from "../api/client";

async function fetchCheckups(signal?: AbortSignal): Promise<Checkup[]> {
  return sortCheckups(await listCheckups(signal)).map(toCheckup);
}

/** Shared checkup state and modal flow for the dashboard and the checkups page. */
export function useCheckups() {
  const [checkups, setCheckups] = useState<Checkup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The checkup open in the modal. Fetched in full when started, because the list
  // only carries a summary and the modal needs the questions.
  const [activeCheckup, setActiveCheckup] = useState<Checkup | null>(null);
  const starting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchCheckups(controller.signal)
      .then((rows) => {
        setCheckups(rows);
        setError(null);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const startCheckup = async (id: string) => {
    if (starting.current) return;
    starting.current = true;
    try {
      setActiveCheckup(toCheckup(await getCheckup(id)));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      starting.current = false;
    }
  };

  const closeCheckup = () => setActiveCheckup(null);

  /** Throws on failure so the modal can show the message and stay open. */
  const completeCheckup = async (id: string, answers: CheckupAnswers) => {
    await submitAnswers(id, answers);
    setActiveCheckup(null);
    // Re-read the list so the finished checkup moves to "Completed"
    try {
      setCheckups(await fetchCheckups());
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return {
    checkups,
    loading,
    error,
    activeCheckup,
    startCheckup,
    closeCheckup,
    completeCheckup,
  };
}
