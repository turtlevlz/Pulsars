import { useEffect, useId, useState } from "react";

type SparklineProps = {
  data: number[];
  /**
   * When each reading was taken (ms), same order as `data`. With these, a new set of
   * readings slides in smoothly instead of snapping. Without them the line just redraws.
   */
  times?: number[];
  color?: string;
};

type Point = { x: number; y: number };
/** One cubic Bezier piece of the line: start, two control points, end. */
type Segment = [Point, Point, Point, Point];
type Series = { values: number[]; times: number[] };

// Keep the line away from the edges of the box (in percent)
const PAD_X = 6;
const PAD_Y = 22;
const WIDTH = 100 - PAD_X * 2;
const HEIGHT = 100 - PAD_Y * 2;
/** The line is cut just outside the padding, leaving room for its round ends. */
const CLIP_X = PAD_X - 1;
const CLIP_WIDTH = WIDTH + 2;

/**
 * How long new readings take to slide in. The dashboard fetches every 5 seconds, so a
 * few new readings arrive at once. Sliding them in over a longer time keeps the end dot
 * from darting up and down as it passes over each one.
 */
const GLIDE_MS = 1500;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Eases in and out, so the slide starts and stops gently and never lurches. */
const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;
const round = (v: number) => Math.round(v * 100) / 100;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The line as cubic Bezier segments that curve smoothly through every point (monotone
 * cubic, the same idea as d3's curveMonotoneX). Between two readings the line only ever
 * rises or falls, never swinging past either one, so it does not invent peaks or dips
 * that are not in the data. Expects at least two points with increasing x.
 */
function smoothSegments(points: Point[]): Segment[] {
  const n = points.length;
  const dx = points.map((p, i) => (i < n - 1 ? points[i + 1].x - p.x : 0));
  // Slope of each straight segment, then the slope the curve should have at each point
  const secant = dx.slice(0, -1).map((d, i) => (points[i + 1].y - points[i].y) / d);
  const tangent = points.map((_, i) => {
    if (i === 0) return secant[0];
    if (i === n - 1) return secant[n - 2];
    // At a peak, a dip or a flat stretch the curve levels out instead of overshooting
    return secant[i - 1] * secant[i] <= 0 ? 0 : (secant[i - 1] + secant[i]) / 2;
  });

  // Fritsch-Carlson: cap tangents so a segment never goes beyond its end points
  secant.forEach((s, i) => {
    if (s === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      return;
    }
    const a = tangent[i] / s;
    const b = tangent[i + 1] / s;
    const sum = a * a + b * b;
    if (sum > 9) {
      const scale = 3 / Math.sqrt(sum);
      tangent[i] = scale * a * s;
      tangent[i + 1] = scale * b * s;
    }
  });

  return secant.map((_, i): Segment => {
    const h = dx[i] / 3;
    const [p, q] = [points[i], points[i + 1]];
    return [
      p,
      { x: p.x + h, y: p.y + tangent[i] * h },
      { x: q.x - h, y: q.y - tangent[i + 1] * h },
      q,
    ];
  });
}

function toPath(segments: Segment[]): string {
  const [start] = segments[0];
  return segments.reduce(
    (d, [, c1, c2, end]) =>
      `${d} C${round(c1.x)},${round(c1.y)} ${round(c2.x)},${round(c2.y)} ${round(end.x)},${round(end.y)}`,
    `M${round(start.x)},${round(start.y)}`,
  );
}

const bezier = (a: number, b: number, c: number, d: number, t: number) =>
  (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;

/**
 * Height of the curve at a given x. The control points sit a third of the way along each
 * segment, so x grows in a straight line with t and t can be read off directly.
 */
function heightAt(segments: Segment[], x: number): number {
  for (const [p, c1, c2, q] of segments) {
    if (x <= q.x + 1e-6) {
      const t = Math.min(1, Math.max(0, (x - p.x) / (q.x - p.x)));
      return bezier(p.y, c1.y, c2.y, q.y, t);
    }
  }
  return segments[segments.length - 1][3].y;
}

/** Where each reading goes in the box, scaled to this set of readings' own min and max. */
function layout(values: number[]): Point[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values.map((value, i) => ({
    x: PAD_X + (i / (values.length - 1)) * WIDTH,
    y: PAD_Y + (1 - (value - min) / range) * HEIGHT,
  }));
}

/**
 * A frame partway from one set of readings to the next (`progress` runs 0 to 1).
 *
 * The two sets overlap, since newer readings push the oldest out. Both are placed on one
 * shared row of readings and the box slides along that row from where the old set sat to
 * where the new one sits: old readings drift left and out, new ones come in from the
 * right.
 *
 * The curve is built once in reading space (x = position in the row, y = the value). Each
 * frame, the scale is fitted to the part of the curve that is inside the box right now,
 * so the line and the end dot always stay inside it, even when the new readings sit far
 * from the old ones. Between a reading entering view and the scale catching up there is
 * never a frame where the line leaves the box.
 */
function glideSegments(from: Series, to: Series, progress: number): Segment[] {
  const byTime = new Map<number, number>();
  for (const series of [from, to]) {
    series.times.forEach((time, i) => byTime.set(time, series.values[i]));
  }
  const row = [...byTime].sort((a, b) => a[0] - b[0]);
  const indexOf = (time: number) => row.findIndex(([t]) => t === time);

  const start = lerp(indexOf(from.times[0]), indexOf(to.times[0]), progress);
  const span = lerp(from.values.length - 1, to.values.length - 1, progress);
  const end = start + span;

  const curve = smoothSegments(row.map(([, value], j) => ({ x: j, y: value })));

  // Lowest and highest point of the curve inside the box: the readings in view, plus
  // where the curve crosses the left and right edges (a monotone curve peaks at readings)
  const inView = row.filter((_, j) => j > start && j < end).map(([, value]) => value);
  const visible = [heightAt(curve, start), heightAt(curve, end), ...inView];
  const min = Math.min(...visible);
  const max = Math.max(...visible);
  const range = max - min || 1;

  const place = ({ x, y }: Point): Point => ({
    x: PAD_X + ((x - start) / span) * WIDTH,
    y: PAD_Y + (1 - (y - min) / range) * HEIGHT,
  });
  return curve.map((segment) => segment.map(place) as Segment);
}

/**
 * Stretches to fill its container. The line is an SVG with a non-scaling
 * stroke, and the end dot is a positioned div so it never gets distorted.
 */
export default function Sparkline({ data, times, color = "#4F46E5" }: SparklineProps) {
  const clipId = useId().replace(/[^\w-]/g, "");

  const series: Series | null =
    times && times.length === data.length ? { values: data, times } : null;
  const key = `${series?.times.join() ?? ""}|${data.join()}`;

  // When the readings change, start sliding from the set that was on screen to the new one.
  // (Adjusting state while rendering, so the first frame already starts at the old line.)
  const [seen, setSeen] = useState({ key, series });
  const [glide, setGlide] = useState<{ from: Series; to: Series } | null>(null);
  const [progress, setProgress] = useState(1);

  if (seen.key !== key) {
    setSeen({ key, series });
    if (
      seen.series &&
      series &&
      seen.series.values.length >= 2 &&
      series.values.length >= 2 &&
      !prefersReducedMotion()
    ) {
      setGlide({ from: seen.series, to: series });
    } else {
      setGlide(null);
    }
    setProgress(0);
  }

  useEffect(() => {
    if (!glide) return;
    let frame = 0;
    let startedAt: number | undefined;

    const tick = (now: number) => {
      startedAt ??= now;
      const t = Math.min(1, (now - startedAt) / GLIDE_MS);
      setProgress(easeInOut(t));
      if (t < 1) frame = requestAnimationFrame(tick);
      else setGlide(null);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [glide]);

  if (data.length < 2) return <div className="sparkline" />;

  const segments = glide
    ? glideSegments(glide.from, glide.to, progress)
    : smoothSegments(layout(data));
  // The dot stays at the right end of the box and rides the line as it slides
  const dotX = PAD_X + WIDTH;

  return (
    <div className="sparkline" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <clipPath id={clipId}>
          <rect x={CLIP_X} y={0} width={CLIP_WIDTH} height={100} />
        </clipPath>
        <path
          d={toPath(segments)}
          clipPath={`url(#${clipId})`}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="sparkline__dot"
        style={{ left: `${dotX}%`, top: `${heightAt(segments, dotX)}%` }}
      />
    </div>
  );
}
