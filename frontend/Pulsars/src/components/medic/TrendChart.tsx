import type { Threshold, TrendPoint } from "../../api/medic";

type TrendChartProps = {
  points: TrendPoint[];
  /** The charted time span (ms). */
  from: number;
  to: number;
  bucketMs: number;
  threshold: Threshold;
  color: string;
  /** For screen readers. */
  label: string;
};

const PAD_X = 3;
const PAD_Y = 14;

/**
 * Bucket averages over a time span, with the vital's limit as a dashed line. The scale always
 * includes the limit, so it is visible even when the readings are far from it. The line breaks
 * where the cuff sent nothing for a while, instead of joining across the gap.
 */
export default function TrendChart({ points, from, to, bucketMs, threshold, color, label }: TrendChartProps) {
  const values = points.map((p) => p.avg);
  const lo = Math.min(threshold.limit, ...values);
  const hi = Math.max(threshold.limit, ...values);
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
  const limitY = y(threshold.limit);

  return (
    <div className="trend" role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <line
          x1={0}
          x2={100}
          y1={limitY}
          y2={limitY}
          className="trend__limit"
          vectorEffect="non-scaling-stroke"
        />
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
      {points.length === 0 && <span className="trend__empty">No readings in this range</span>}
    </div>
  );
}
