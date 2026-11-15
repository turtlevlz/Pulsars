export type SymptomRecord = {
  id: string;
  symptom: string;
  severity: number;
  notes: string;
  /** ISO date string. */
  loggedAt: string;
};

type SymptomHistoryProps = {
  records: SymptomRecord[];
};

const LEVELS = [1, 2, 3, 4, 5];

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SymptomHistory({ records }: SymptomHistoryProps) {
  return (
    <section className="card history" aria-labelledby="history-title">
      <h2 id="history-title" className="card__title card__title--lg">
        Recent entries
      </h2>

      {records.length === 0 ? (
        <p className="history__empty">No symptoms logged yet.</p>
      ) : (
        <ul className="history__list">
          {records.map((record) => (
            <li key={record.id} className="history__item">
              <div className="history__top">
                <span className="history__symptom">{record.symptom}</span>
                <time className="history__date" dateTime={record.loggedAt}>
                  {formatDate(record.loggedAt)}
                </time>
              </div>

              <div
                className="history__meter"
                role="img"
                aria-label={`Severity ${record.severity} of 5`}
              >
                {LEVELS.map((level) => (
                  <span
                    key={level}
                    className={`history__dot${level <= record.severity ? " history__dot--on" : ""}`}
                  />
                ))}
                <span className="history__level">{record.severity}/5</span>
              </div>

              {record.notes && <p className="history__notes">{record.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}