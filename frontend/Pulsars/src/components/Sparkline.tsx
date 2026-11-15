type SparklineProps = {
  data: number[];
  color?: string;
};

/**
 * Stretches to fill its container. The line is an SVG with a non-scaling
 * stroke, and the end dot is a positioned div so it never gets distorted.
 */
export default function Sparkline({ data, color = "#4F46E5" }: SparklineProps) {
  if (data.length < 2) return <div className="sparkline" />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Keep the line away from the edges of the box (in percent)
  const padX = 6;
  const padY = 22;

  const points = data.map((value, i) => {
    const x = padX + (i / (data.length - 1)) * (100 - padX * 2);
    const y = padY + (1 - (value - min) / range) * (100 - padY * 2);
    return { x, y };
  });

  const last = points[points.length - 1];

  return (
    <div className="sparkline" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
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
        style={{ left: `${last.x}%`, top: `${last.y}%` }}
      />
    </div>
  );
}