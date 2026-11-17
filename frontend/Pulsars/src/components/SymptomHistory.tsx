import { useState } from "react";

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
  /** Shown when the list is empty, e.g. while loading. */
  emptyMessage?: string;
};

const LEVELS = [1, 2, 3, 4, 5];

/** Entries per page; about what fits beside the "Log a symptom" card. */
const PAGE_SIZE = 5;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SymptomHistory({
  records,
  emptyMessage = "No symptoms logged yet.",
}: SymptomHistoryProps) {
  const [page, setPage] = useState(0);

  // A newly saved entry lands at the top of the list, so show the first page again.
  const newestId = records[0]?.id;
  const [seenNewestId, setSeenNewestId] = useState(newestId);
  if (newestId !== seenNewestId) {
    setSeenNewestId(newestId);
    setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const first = current * PAGE_SIZE;
  const visible = records.slice(first, first + PAGE_SIZE);

  return (
    <section className="card history" aria-labelledby="history-title">
      <h2 id="history-title" className="card__title card__title--lg">
        Recent entries
      </h2>

      {records.length === 0 ? (
        <p className="history__empty">{emptyMessage}</p>
      ) : (
        <ul className="history__list">
          {visible.map((record) => (
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

      {pageCount > 1 && (
        <nav className="history__pager" aria-label="Symptom entry pages">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setPage(current - 1)}
            disabled={current === 0}
          >
            Previous
          </button>
          <span className="history__range" aria-live="polite">
            {first + 1}&ndash;{first + visible.length} of {records.length}
          </span>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setPage(current + 1)}
            disabled={current >= pageCount - 1}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}