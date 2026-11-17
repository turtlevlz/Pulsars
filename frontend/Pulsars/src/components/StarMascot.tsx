import { useEffect, useMemo, useRef, useState } from "react";

type StarMascotProps = {
  /** When true the mascot blinks once and looks down (e.g. input is focused). */
  lookDown?: boolean;
  size?: number;
  className?: string;
};

/** Builds a smooth, rounded 6 pointed star path inside a 120x120 viewBox. */
function buildStarPath(points = 6, outer = 52, inner = 40, cx = 60, cy = 60) {
  const verts: [number, number][] = [];
  const total = points * 2;
  for (let i = 0; i < total; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * 2 * i) / total - Math.PI / 2;
    verts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  const mid = (a: [number, number], b: [number, number]) => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const start = mid(verts[total - 1], verts[0]);
  let d = `M ${start[0].toFixed(2)} ${start[1].toFixed(2)}`;
  for (let i = 0; i < total; i++) {
    const v = verts[i];
    const m = mid(v, verts[(i + 1) % total]);
    d += ` Q ${v[0].toFixed(2)} ${v[1].toFixed(2)} ${m[0].toFixed(2)} ${m[1].toFixed(2)}`;
  }
  return d + " Z";
}

export default function StarMascot({
  lookDown = false,
  size = 160,
  className,
}: StarMascotProps) {
  const [blinking, setBlinking] = useState(false);
  const blinkTimer = useRef<number | undefined>(undefined);
  const path = useMemo(() => buildStarPath(), []);

  const blinkOnce = () => {
    setBlinking(true);
    window.clearTimeout(blinkTimer.current);
    blinkTimer.current = window.setTimeout(() => setBlinking(false), 140);
  };

  // Idle blinking at random intervals
  useEffect(() => {
    let id: number;
    const schedule = () => {
      id = window.setTimeout(() => {
        blinkOnce();
        schedule();
      }, 2200 + Math.random() * 3200);
    };
    schedule();
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(blinkTimer.current);
    };
  }, []);

  // Blink as the gaze shifts, so the movement feels natural
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    blinkOnce();
  }, [lookDown]);

  const eyeStyle: React.CSSProperties = {
    transformBox: "fill-box",
    transformOrigin: "center",
    transform: `scaleY(${blinking ? 0.08 : 1})`,
    transition: "transform 110ms ease-in-out",
  };

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="Star mascot"
    >
      <defs>
        <linearGradient id="star-fill" x1="0.2" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="#5B5BD6" />
          <stop offset="100%" stopColor="#8E7CFF" />
        </linearGradient>
      </defs>

      {/* Body tilts slightly forward when looking down */}
      <g
        style={{
          transformBox: "fill-box",
          transformOrigin: "center",
          transform: lookDown ? "translateY(2px) scale(0.98)" : "none",
          transition: "transform 350ms cubic-bezier(.3,1.4,.5,1)",
        }}
      >
        <path d={path} fill="url(#star-fill)" />

        {/* Face */}
        <g
          style={{
            transform: `translate(${0}px, ${lookDown ? 9 : 0}px)`,
            transition: "transform 350ms cubic-bezier(.3,1.4,.5,1)",
          }}
        >
          <rect x="45" y="48" width="9" height="16" rx="4.5" fill="#fff" fillOpacity="0.92" style={eyeStyle} />
          <rect x="66" y="48" width="9" height="16" rx="4.5" fill="#fff" fillOpacity="0.92" style={eyeStyle} />
        </g>
      </g>

      <style>{`
        @media (prefers-reduced-motion: reduce) {
          svg * { transition: none !important; }
        }
      `}</style>
    </svg>
  );
}