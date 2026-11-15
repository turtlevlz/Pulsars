import { formatWhen } from "../../lib/medic";

type SummaryPanelProps = {
  title: string;
  bullets: string[];
  generatedAt: number;
};

/** A plain tally of the numbers on the page. Written by rules, not by a model. */
export default function SummaryPanel({ title, bullets, generatedAt }: SummaryPanelProps) {
  return (
    <section className="card medic-summary" aria-labelledby="summary-title">
      <header className="medic-panel__head">
        <h2 id="summary-title" className="card__title card__title--lg">
          Summary
        </h2>
        <span className="medic-panel__meta">
          Auto-generated {formatWhen(new Date(generatedAt).toISOString(), generatedAt)} | Review before acting
        </span>
      </header>
      <h3 className="medic-summary__title">{title}</h3>
      <ul className="medic-summary__list">
        {bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </section>
  );
}
