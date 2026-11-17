import { useEffect, useState } from "react";

/** The current time in ms, refreshed every `everyMs` so "updated 5 s ago" keeps counting. */
export function useNow(everyMs = 1000) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);

  return now;
}
