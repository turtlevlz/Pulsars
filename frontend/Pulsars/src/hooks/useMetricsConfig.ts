import { useEffect, useState } from "react";
import { errorMessage } from "../api/client";
import { getMetricsConfig } from "../api/metrics";
import type { MetricsConfig } from "../api/metrics";

// The config never changes while the app is open, so it is fetched once and shared.
let cached: MetricsConfig | null = null;
let inFlight: Promise<MetricsConfig> | null = null;

function load(): Promise<MetricsConfig> {
  if (cached) return Promise.resolve(cached);
  inFlight ??= getMetricsConfig()
    .then((config) => (cached = config))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** The thresholds, evidence and plain-language text from the backend (`config`: null until loaded). */
export function useMetricsConfig() {
  const [config, setConfig] = useState<MetricsConfig | null>(cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cached) return;
    let live = true;
    load()
      .then((c) => live && setConfig(c))
      .catch((err) => live && setError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, []);

  return { config, error };
}
