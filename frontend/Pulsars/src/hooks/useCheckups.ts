import { useState } from "react";
import type { Checkup } from "../components/Checkups";
import type { CheckupAnswers } from "../lib/questionnaire";
import { INITIAL_CHECKUPS } from "../api/checkups";

/** Shared checkup state and modal flow for the dashboard and the checkups page. */
export function useCheckups() {
  const [checkups, setCheckups] = useState<Checkup[]>(INITIAL_CHECKUPS);
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeCheckup = checkups.find((c) => c.id === activeId) ?? null;

  const startCheckup = (id: string) => setActiveId(id);
  const closeCheckup = () => setActiveId(null);

  const completeCheckup = (id: string, answers: CheckupAnswers) => {
    // Send `answers` to your backend here
    console.log("Checkup answers", id, answers);
    setCheckups((prev) =>
      prev.map((c) => (c.id === id ? { ...c, completed: true } : c)),
    );
    setActiveId(null);
  };

  return {
    checkups,
    activeCheckup,
    startCheckup,
    closeCheckup,
    completeCheckup,
  };
}