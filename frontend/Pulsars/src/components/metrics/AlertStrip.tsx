import { Link } from "react-router-dom";
import type { AlertItem } from "../../api/metrics";
import TierBadge from "./TierBadge";
import "../../styles/Metrics.css";

type AlertStripProps = {
  alerts: AlertItem[];
};

// The dashboard is one window tall: the strip shows the two worst alerts and says how many more.
const MAX_SHOWN = 2;

/**
 * Yellow and red right now, each with the one thing to do. Nothing is drawn when everything is
 * fine. The reason for each is on its tile and its details page (and on hover here).
 */
export default function AlertStrip({ alerts }: AlertStripProps) {
  if (alerts.length === 0) return null;
  const ordered = [...alerts].sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1));
  const shown = ordered.slice(0, MAX_SHOWN);
  const more = ordered.length - shown.length;
  return (
    <section className="alert-strip" aria-label="Health alerts">
      <ul className="alert-strip__list">
        {shown.map((a) => (
          <li key={a.ruleId} className={`alert-strip__item alert-strip__item--${a.level}`} title={a.reason}>
            <TierBadge level={a.level} small />
            <p className="alert-strip__text">
              <strong>{a.title}.</strong> {a.recommendedAction}
              {a.escalateTo && <> Tell the {a.escalateTo}.</>}
            </p>
            {a.kind === "metric" && (
              <Link to={`/metrics/${a.ruleId}`} className="tier-note__link">
                Details
              </Link>
            )}
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="alert-strip__more">
          and {more} more: {ordered.slice(MAX_SHOWN).map((a) => a.title).join(", ")}
        </p>
      )}
    </section>
  );
}
