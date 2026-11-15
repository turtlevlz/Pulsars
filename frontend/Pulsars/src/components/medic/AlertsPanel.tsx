import { useState } from "react";
import { errorMessage } from "../../api/client";
import type { Alert } from "../../api/medic";
import { alertMetric, formatDuration, formatValue, formatWhen } from "../../lib/medic";

type AlertsPanelProps = {
  alerts: Alert[];
  now: number;
  /** Throws on failure. */
  onAcknowledge: (alert: Alert) => Promise<void>;
};

const keyOf = (a: Alert) => `${a.type}|${a.startedAt}`;

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
          Threshold alerts
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
          {filter === "open" ? "No open alerts." : "No threshold alerts in this range."}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Metric</th>
                <th scope="col">Value</th>
                <th scope="col">Limit</th>
                <th scope="col">Duration</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={keyOf(a)}>
                  <td>{formatWhen(a.startedAt, now)}</td>
                  <td>{alertMetric(a.type)}</td>
                  <td>
                    <strong>
                      {formatValue(a.type, a.peak)} {a.unit}
                    </strong>
                  </td>
                  <td>
                    {a.threshold.bound === "upper" ? "above" : "below"} {a.threshold.limit}
                  </td>
                  <td>
                    {formatDuration(a.durationMinutes)}
                    {a.ongoing && <span className="data-table__soft"> ongoing</span>}
                  </td>
                  <td>
                    <span className={`chip ${a.status === "open" ? "chip--alert" : "chip--quiet"}`}>
                      {a.status === "open" ? "Open" : "Acknowledged"}
                    </span>
                  </td>
                  <td className="data-table__action">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
