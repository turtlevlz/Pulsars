import { useState } from "react";
import type { PointerEvent } from "react";
import type { BaselineBand, Threshold, TrendPoint } from "../../api/medic";
import { formatWhen } from "../../lib/medic";

type TrendChartProps = {
  points: TrendPoint[];
  /** The charted time span (ms). */
  from: number;
  to: number;
  bucketMs: number;
  /** A dashed reference line; none where a single limit would mislead. */
  threshold: Threshold | null;
  /** The person's usual range over the span, shaded behind the line. */
  baseline?: BaselineBand[] | null;
  color: string;
  /** For screen readers. */
  label: string;
  /** A number the way this vital is written (decimals); the unit is in the card. */
  formatValue: (value: number) => string;
};

const PAD_X = 3;
const PAD_Y = 14;

/**
 * Bucket averages over a time span, with the vital's reference limit as a dashed line and, where
 * the person has a baseline, their usual range as a shaded band. The scale always includes both,
 * so they are visible even when the readings are far from them, and its two ends are written on
 * the chart. The line breaks where the cuff sent nothing for a while, instead of joining across
 * the gap. Pointing at the chart reads out the nearest bucket (value, time, and its low and high).
 */
export default function TrendChart({
  points,
  from,
  to,
  bucketMs,
  threshold,
  baseline,
  color,
  label,
  formatValue,
}: TrendChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  const band = (baseline ?? []).filter((b) => Date.parse(b.t) >= from && Date.parse(b.t) <= to);
  const values = points.map((p) => p.avg);
  const scale = [...values, ...band.flatMap((b) => [b.low, b.high]), ...(threshold ? [threshold.limit] : [])];
  const lo = scale.length > 0 ? Math.min(...scale) : 0;
  const hi = scale.length > 0 ? Math.max(...scale) : 1;
  const span = hi - lo || 1;
  const span_t = to - from || 1;

  const x = (t: number) => PAD_X + ((t - from) / span_t) * (100 - PAD_X * 2);
  const y = (v: number) => PAD_Y + (1 - (v - lo) / span) * (100 - PAD_Y * 2);
  const clampX = (t: number) => Math.min(100 - PAD_X, Math.max(PAD_X, x(t)));

  // Pieces of the line, split where there is a gap of more than a few buckets.
  const pieces: TrendPoint[][] = [];
  for (const p of points) {
    const piece = pieces[pieces.length - 1];
    const prev = piece?.[piece.length - 1];
    if (!piece || Date.parse(p.t) - Date.parse(prev.t) > bucketMs * 3) pieces.push([p]);
    else piece.push(p);
  }
  const path = pieces
    .filter((piece) => piece.length > 1)
    .map((piece) => piece.map((p, i) => `${i === 0 ? "M" : "L"}${clampX(Date.parse(p.t)).toFixed(2)},${y(p.avg).toFixed(2)}`).join(" "))
    .join(" ");

  const last = points[points.length - 1];
  // Readings that stand alone (no neighbour within a few buckets) can't make a line, so they are dots.
  const lonely = pieces.filter((piece) => piece.length === 1 && piece[0] !== last).map((piece) => piece[0]);
  const limitY = threshold ? y(threshold.limit) : null;
  // The usual range as one shape: along the top edge, back along the bottom edge
  const bandPath =
    band.length > 1
      ? `${band.map((b, i) => `${i === 0 ? "M" : "L"}${clampX(Date.parse(b.t)).toFixed(2)},${y(b.high).toFixed(2)}`).join(" ")} ${[...band]
          .reverse()
          .map((b) => `L${clampX(Date.parse(b.t)).toFixed(2)},${y(b.low).toFixed(2)}`)
          .join(" ")} Z`
      : "";

  // Pointing at the chart: the bucket nearest in time, if one is close enough to mean something
  const point = (event: PointerEvent<HTMLDivElement>) => {
    if (points.length === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const percent = ((event.clientX - box.left) / box.width) * 100;
    const at = from + ((percent - PAD_X) / (100 - PAD_X * 2)) * span_t;
    let nearest = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(Date.parse(points[i].t) - at) < Math.abs(Date.parse(points[nearest].t) - at)) nearest = i;
    }
    setHover(Math.abs(Date.parse(points[nearest].t) - at) <= bucketMs * 2 ? nearest : null);
  };

  const hovered = hover !== null && hover < points.length ? points[hover] : null;
  const hoverX = hovered ? clampX(Date.parse(hovered.t)) : 0;

  return (
    <div
      className="trend"
      role="img"
      aria-label={label}
      onPointerMove={point}
      onPointerDown={point}
      onPointerLeave={() => setHover(null)}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {scale.length > 0 && (
          <>
            <line x1={0} x2={100} y1={y(hi)} y2={y(hi)} className="trend__grid" vectorEffect="non-scaling-stroke" />
            <line x1={0} x2={100} y1={y(lo)} y2={y(lo)} className="trend__grid" vectorEffect="non-scaling-stroke" />
          </>
        )}
        {bandPath && <path d={bandPath} className="trend__band" />}
        {limitY !== null && (
          <line
            x1={0}
            x2={100}
            y1={limitY}
            y2={limitY}
            className="trend__limit"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {path && (
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {scale.length > 0 && (
        <>
          <span className="trend__y" style={{ top: `${y(hi)}%` }} aria-hidden="true">
            {formatValue(hi)}
          </span>
          {lo !== hi && (
            <span className="trend__y" style={{ top: `${y(lo)}%` }} aria-hidden="true">
              {formatValue(lo)}
            </span>
          )}
        </>
      )}
      {lonely.map((p) => (
        <span
          key={p.t}
          className="trend__speck"
          style={{ left: `${clampX(Date.parse(p.t))}%`, top: `${y(p.avg)}%`, background: color }}
        />
      ))}
      {last && (
        <span
          className="sparkline__dot trend__dot"
          style={{ left: `${clampX(Date.parse(last.t))}%`, top: `${y(last.avg)}%` }}
        />
      )}
      {hovered && (
        <>
          <span className="trend__cursor" style={{ left: `${hoverX}%` }} aria-hidden="true" />
          <span
            className="trend__hover-dot"
            style={{ left: `${hoverX}%`, top: `${y(hovered.avg)}%`, borderColor: color }}
            aria-hidden="true"
          />
          <div
            className="trend__tip"
            style={hoverX > 50 ? { right: `${100 - hoverX}%` } : { left: `${hoverX}%` }}
            aria-hidden="true"
          >
            <strong>{formatValue(hovered.avg)}</strong>
            <span>{formatWhen(hovered.t)}</span>
            {hovered.min !== hovered.max && (
              <span>
                {formatValue(hovered.min)} to {formatValue(hovered.max)}
              </span>
            )}
          </div>
        </>
      )}
      {points.length === 0 && <span className="trend__empty">No readings in this range</span>}
    </div>
  );
}
