import { useState } from "react";
import type { Symptom } from "../../api/symptoms";
import { formatDay } from "../../lib/medic";

const COLLAPSED_ROWS = 5;

export default function SymptomPanel({ symptoms, now }: { symptoms: Symptom[]; now: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? symptoms : symptoms.slice(0, COLLAPSED_ROWS);
  const hidden = symptoms.length - COLLAPSED_ROWS;

  return (
    <section className="card medic-symptoms" aria-labelledby="symptoms-title">
      <h2 id="symptoms-title" className="card__title card__title--lg">
        Symptom log
      </h2>
      {symptoms.length === 0 ? (
        <p className="history__empty">No symptoms logged in this range.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Symptom</th>
                <th scope="col">Severity</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td>{formatDay(s.loggedAt, now)}</td>
                  <td>{s.name}</td>
                  <td>{s.intensity} / 5</td>
                  <td className="data-table__wrap">{s.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hidden > 0 && (
        <button type="button" className="link-button" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show fewer" : `Show all ${symptoms.length}`}
        </button>
      )}
    </section>
  );
}
