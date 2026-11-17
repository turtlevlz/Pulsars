import { Link } from "react-router-dom";
import type { SymptomRecord } from "./SymptomHistory";
import "../styles/Overview.css";

type RecentSymptomsProps = {
  records: SymptomRecord[];
  loading?: boolean;
  /** Where "View all" goes. */
  viewAllTo?: string;
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

/**
 * Goes at the bottom of the "Log a symptom" card. It takes whatever height the form leaves over
 * and hides itself when that is too little to be useful, so the card never has a blank stretch
 * under the Save button (see Overview.css).
 */
export default function RecentSymptoms({
  records,
  loading = false,
  viewAllTo = "/symptom-log",
}: RecentSymptomsProps) {
  return (
    <div className="symptom-log__recent">
      <div className="recent">
        <div className="recent__head">
          <h3 className="recent__title">Recent entries</h3>
          {records.length > 0 && (
            <Link className="recent__more" to={viewAllTo}>
              View all
            </Link>
          )}
        </div>

        {records.length === 0 ? (
          <p className="recent__empty">{loading ? "Loading..." : "Nothing logged yet."}</p>
        ) : (
          <ul className="recent__list">
            {records.map((record) => (
              <li key={record.id} className="recent__item">
                <span className="recent__name">{record.symptom}</span>
                <span
                  className="recent__meter"
                  role="img"
                  aria-label={`Severity ${record.severity} of 5`}
                >
                  {LEVELS.map((level) => (
                    <span
                      key={level}
                      className={`history__dot${level <= record.severity ? " history__dot--on" : ""}`}
                    />
                  ))}
                </span>
                <time className="recent__date" dateTime={record.loggedAt}>
                  {formatDate(record.loggedAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
