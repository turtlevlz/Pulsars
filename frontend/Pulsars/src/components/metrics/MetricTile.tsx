import type { MetricConfig, MetricStatus } from "../../api/metrics";
import { ageText } from "../../lib/metrics";
import TierBadge from "./TierBadge";
import TierNote from "./TierNote";
import "../../styles/Metrics.css";

type MetricTileProps = {
  config: MetricConfig | undefined;
  status: MetricStatus | null;
  /** Fallback title while the config loads. */
  title: string;
  detailsTo?: string;
};

/** A tier tile for a metric that comes from a log (blood pressure, sleep, ...): the value, its tier and why. */
export default function MetricTile({ config, status, title, detailsTo }: MetricTileProps) {
  return (
    <article className={`card metric-tile metric-tile--${status?.level ?? "gray"}`}>
      <header className="metric-tile__header">
        <h2 className="card__title">{config?.title ?? title}</h2>
        <TierBadge level={status?.level ?? "gray"} />
      </header>
      <p className="metric-tile__reading">
        <span className="metric-tile__value">{status?.display ?? "--"}</span>
        <span className="metric-tile__age">{status ? `Logged ${ageText(status)}` : ""}</span>
      </p>
      <TierNote status={status} detailsTo={detailsTo} />
    </article>
  );
}
