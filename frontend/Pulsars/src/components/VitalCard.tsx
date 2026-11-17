import type { MetricStatus } from "../api/metrics";
import { useNow } from "../hooks/useNow";
import { STALE_AFTER_MS, formatAge } from "../lib/vitals";
import TierNote from "./metrics/TierNote";
import Sparkline from "./Sparkline";

type VitalCardProps = {
  label: string;
  value: string | number;
  unit: string;
  /** When the latest reading was taken (ms), or null if there is none. */
  updatedAt: number | null;
  /** True until the first fetch has finished. */
  loading?: boolean;
  /** Recent readings, oldest first. The last one gets the end dot. */
  trend: number[];
  /** When each `trend` reading was taken (ms); lets the line slide when readings update. */
  trendTimes?: number[];
  /** Line color for the sparkline. */
  accent?: string;
  /** The metric's health tier. Left out where tiers are not shown. */
  status?: MetricStatus | null;
  /** Where "Details" goes. */
  detailsTo?: string;
};

export default function VitalCard({
  label,
  value,
  unit,
  updatedAt,
  loading = false,
  trend,
  trendTimes,
  accent,
  status,
  detailsTo,
}: VitalCardProps) {
  const now = useNow();
  // A device clock a little ahead of ours must not show a negative age
  const age = updatedAt === null ? null : Math.max(0, now - updatedAt);
  const stale = age !== null && age > STALE_AFTER_MS;
  const state = age === null ? (loading ? "Loading" : "No data") : stale ? "Stale" : "Live";

  const tiered = status !== undefined;
  return (
    <article
      className={`card vital-card${stale ? " vital-card--stale" : ""}${tiered ? ` vital-card--${status?.level ?? "gray"}` : ""}`}
    >
      <header className="vital-card__header">
        <h2 className="card__title">{label}</h2>
        <span className={`pill${state === "Live" ? "" : " pill--quiet"}`}>{state}</span>
      </header>

      <p className="vital-card__reading">
        <span className="vital-card__value">{value}</span>
        <span className="vital-card__unit">{unit}</span>
        {age !== null && <span className="vital-card__updated">Updated {formatAge(age)}</span>}
      </p>

      <Sparkline data={trend} times={trendTimes} color={accent} />

      {tiered && <TierNote status={status} detailsTo={detailsTo} withBadge />}
    </article>
  );
}
