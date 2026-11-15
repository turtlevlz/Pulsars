import type { Latest, Trend } from "../../api/medic";
import type { VitalType } from "../../api/vitals";
import {
  breaches,
  describeLimit,
  formatAgo,
  formatValue,
  trendDirection,
  vitalAccent,
  vitalLabel,
} from "../../lib/medic";
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
};

/** A reading older than this is history, not something to flag as "past the limit" right now. */
const RECENT_MS = 15 * 60_000;

export default function TrendCard({ type, trend, latest, rangePhrase, rangeAgo, now }: TrendCardProps) {
  const direction = trendDirection(type, trend.points);
  const over =
    latest !== null && now - Date.parse(latest.recordedAt) <= RECENT_MS && breaches(trend.threshold, latest.value);

  return (
    <article className={`card vital-card medic-vital${over ? " medic-vital--over" : ""}`}>
      <header className="vital-card__header">
        <h3 className="card__title">{vitalLabel(type)}</h3>
        {over && <span className="chip chip--alert">Past limit</span>}
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
        color={vitalAccent(type)}
        label={`${vitalLabel(type)} over the ${rangePhrase}`}
      />

      <div className="trend__axis" aria-hidden="true">
        <span>{rangeAgo}</span>
        <span>now</span>
      </div>

      <div className="medic-vital__notes">
        <p className="medic-vital__note">Dashed line: {describeLimit(trend.threshold)}</p>
        <p className="medic-vital__note">
          Trend over the {rangePhrase}: {direction ?? "not enough data"}
        </p>
      </div>
    </article>
  );
}
