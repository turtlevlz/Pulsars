import { useState } from "react";
import { errorMessage } from "../../api/client";
import type { Alert } from "../../api/medic";
import { formatDuration, formatWhen } from "../../lib/medic";
import EvidenceChip from "../metrics/EvidenceChip";
import TierBadge from "../metrics/TierBadge";

type AlertsPanelProps = {
  alerts: Alert[];
  now: number;
  /** Throws on failure. */
  onAcknowledge: (alert: Alert) => Promise<void>;
};

const keyOf = (a: Alert) => `${a.ruleId}|${a.startedAt}`;

export default function AlertsPanel({ alerts, now, onAcknowledge }: AlertsPanelProps) {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = alerts.filter((a) => a.status === "open");
  const shown = filter === "open" ? open : alerts;

  const acknowledge = async (alert: Alert) => {
    setBusy(keyOf(alert));
    setError(null);
    try {
      await onAcknowledge(alert);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card medic-alerts" aria-labelledby="alerts-title">
      <header className="medic-panel__head">
        <h2 id="alerts-title" className="card__title card__title--lg">
          Health alerts
        </h2>
        <div className="segmented" role="group" aria-label="Which alerts to show">
          <button
            type="button"
            className={`segmented__btn${filter === "open" ? " segmented__btn--on" : ""}`}
            aria-pressed={filter === "open"}
            onClick={() => setFilter("open")}
          >
            Open ({open.length})
          </button>
          <button
            type="button"
            className={`segmented__btn${filter === "all" ? " segmented__btn--on" : ""}`}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All ({alerts.length})
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="history__empty">
          {filter === "open" ? "No open alerts." : "No health alerts in this range."}
        </p>
      ) : (
        // Rows, not a table: the reason and the action are sentences, and a table with a wide
        // column pushed the Acknowledge button out of the card.
        <ul className="alert-list">
          {shown.map((a) => (
            <li key={keyOf(a)} className="alert-row">
              <div className="alert-row__when">
                <span>{formatWhen(a.startedAt, now)}</span>
                <span className="data-table__soft">
                  {formatDuration(a.durationMinutes)}
                  {a.ongoing && ", ongoing"}
                </span>
              </div>

              <div className="alert-row__body">
                <div className="alert-row__what">
                  <strong>{a.title}</strong>
                  <TierBadge level={a.level} small />
                  <EvidenceChip level={a.evidenceLevel} />
                </div>
                <p>{a.reason}</p>
                <p className="data-table__soft">
                  <strong>Action:</strong> {a.recommendedAction}
                </p>
              </div>

              <div className="alert-row__side">
                <span className={`chip ${a.status === "open" ? "chip--alert" : "chip--quiet"}`}>
                  {a.status === "open" ? "Open" : "Acknowledged"}
                </span>
                {a.status === "open" ? (
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={busy === keyOf(a)}
                    onClick={() => void acknowledge(a)}
                  >
                    {busy === keyOf(a) ? "Saving..." : "Acknowledge"}
                  </button>
                ) : (
                  <span className="data-table__soft">
                    {a.acknowledgedBy ? `by ${a.acknowledgedBy.name}` : ""}
                    {a.acknowledgedAt ? ` ${formatWhen(a.acknowledgedAt, now)}` : ""}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
