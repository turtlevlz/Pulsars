import { useEffect, useState } from "react";
import { errorMessage } from "../../api/client";
import { listLogs } from "../../api/metrics";
import type { LogEntry, LogKind, LogSymptom } from "../../api/metrics";
import { LOG_KIND_LABEL, describeLog, formatLogTime } from "../../lib/logs";
import "../../styles/Metrics.css";

type LogHistoryProps = {
  kind: LogKind;
  symptoms: LogSymptom[];
  /** Changes whenever something was saved, so the list is fetched again. */
  version: number;
  /** Entries per page; about what fits beside the form. */
  pageSize?: number;
};

type Loaded = { key: string; entries: LogEntry[] };

/** The latest entries of one kind, newest first, a few to a page. */
export default function LogHistory({ kind, symptoms, version, pageSize = 5 }: LogHistoryProps) {
  const key = `${kind}|${version}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [pageState, setPageState] = useState({ kind, page: 0 });

  useEffect(() => {
    const controller = new AbortController();
    listLogs(kind, 50, 0, controller.signal)
      .then((entries) => {
        setLoaded({ key, entries });
        setFailure(null);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setFailure({ key, message: errorMessage(err) });
      });
    return () => controller.abort();
  }, [kind, key]);

  const entries = loaded && loaded.key.startsWith(`${kind}|`) ? loaded.entries : null;
  const error = failure && failure.key.startsWith(`${kind}|`) ? failure.message : null;

  // Another kind, or a newly saved entry (it lands at the top), starts again at the first page.
  const newestId = entries?.[0]?.id;
  const [seenNewest, setSeenNewest] = useState(newestId);
  if (newestId !== seenNewest) {
    setSeenNewest(newestId);
    setPageState({ kind, page: 0 });
  }
  const page = pageState.kind === kind ? pageState.page : 0;

  const all = entries ?? [];
  const pageCount = Math.max(1, Math.ceil(all.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const first = current * pageSize;
  const visible = all.slice(first, first + pageSize);

  return (
    <section className="card history" aria-labelledby="log-history-title">
      <h2 id="log-history-title" className="card__title card__title--lg">
        Recent entries: {LOG_KIND_LABEL[kind].toLowerCase()}
      </h2>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {all.length === 0 ? (
        <p className="history__empty">{entries === null && !error ? "Loading..." : "Nothing logged yet."}</p>
      ) : (
        <ul className="history__list">
          {visible.map((entry) => (
            <li key={entry.id} className="history__item">
              <div className="history__top">
                <span className="history__symptom">{LOG_KIND_LABEL[entry.kind]}</span>
                <time className="history__date" dateTime={entry.recordedAt}>
                  {formatLogTime(entry.recordedAt)}
                </time>
              </div>
              <p className="history__notes">{describeLog(entry, symptoms)}</p>
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <nav className="history__pager" aria-label="Log entry pages">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setPageState({ kind, page: current - 1 })}
            disabled={current === 0}
          >
            Previous
          </button>
          <span className="history__range" aria-live="polite">
            {first + 1}&ndash;{first + visible.length} of {all.length}
          </span>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setPageState({ kind, page: current + 1 })}
            disabled={current >= pageCount - 1}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
