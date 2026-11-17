import type { Latest, Trend } from "../../api/medic";
import type { MetricStatus } from "../../api/metrics";
import type { VitalType } from "../../api/vitals";
import {
  describeLimit,
  formatAgo,
  formatValue,
  trendDirection,
  vitalAccent,
  vitalLabel,
} from "../../lib/medic";
import TierNote from "../metrics/TierNote";
import TrendChart from "./TrendChart";

type TrendCardProps = {
  type: VitalType;
  trend: Trend;
  latest: Latest[VitalType];
  /** Text after "Trend over the", e.g. "last 7 days". */
  rangePhrase: string;
  /** Label for the left end of the time axis, e.g. "7 d ago". */
  rangeAgo: string;
  now: number;
  /** The tier of the metric this vital feeds; null while it loads. */
  status: MetricStatus | null;
};

export default function TrendCard({ type, trend, latest, rangePhrase, rangeAgo, now, status }: TrendCardProps) {
  const direction = trendDirection(type, trend.points);

  return (
    <article className={`card vital-card medic-vital vital-card--${status?.level ?? "gray"}`}>
      <header className="vital-card__header">
        <h3 className="card__title">{vitalLabel(type)}</h3>
      </header>

      <p className="vital-card__reading">
        <span className="vital-card__value">{latest ? formatValue(type, latest.value) : "--"}</span>
        <span className="vital-card__unit">{trend.unit}</span>
        {latest && (
          <span className="vital-card__updated">{formatAgo(Math.max(0, now - Date.parse(latest.recordedAt)))}</span>
        )}
      </p>

      <TrendChart
        points={trend.points}
        from={Date.parse(trend.from)}
        to={Date.parse(trend.to)}
        bucketMs={trend.bucketSeconds * 1000}
        threshold={trend.threshold}
        baseline={trend.baseline}
        color={vitalAccent(type)}
        label={`${vitalLabel(type)} over the ${rangePhrase}`}
        formatValue={(value) => formatValue(type, value)}
      />

      <div className="trend__axis" aria-hidden="true">
        <span>{rangeAgo}</span>
        <span>now</span>
      </div>

      <TierNote status={status} withBadge />

      <ul className="trend__legend">
        {trend.threshold && (
          <li>
            <span className="trend__swatch trend__swatch--limit" aria-hidden="true" />
            {describeLimit(trend.threshold)}
          </li>
        )}
        {trend.baseline && (
          <li>
            <span className="trend__swatch trend__swatch--band" aria-hidden="true" />
            This person's usual range
          </li>
        )}
        <li>
          Trend over the {rangePhrase}: {direction ?? "not enough data"}
        </li>
      </ul>
    </article>
  );
}
