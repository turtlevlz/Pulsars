import Sparkline from "./Sparkline";

export type VitalStatus = "High" | "Normal" | "Low" | "No data" | "Loading";

type VitalCardProps = {
  label: string;
  value: string | number;
  unit: string;
  status: VitalStatus;
  /** Recent readings, oldest first. The last one gets the end dot. */
  trend: number[];
  /** When each `trend` reading was taken (ms); lets the line slide when readings update. */
  trendTimes?: number[];
  /** Line color for the sparkline. */
  accent?: string;
};

export default function VitalCard({
  label,
  value,
  unit,
  status,
  trend,
  trendTimes,
  accent,
}: VitalCardProps) {
  return (
    <article className="card vital-card">
      <header className="vital-card__header">
        <h2 className="card__title">{label}</h2>
        <span className="pill">{status}</span>
      </header>

      <p className="vital-card__reading">
        <span className="vital-card__value">{value}</span>
        <span className="vital-card__unit">{unit}</span>
      </p>

      <Sparkline data={trend} times={trendTimes} color={accent} />
    </article>
  );
}