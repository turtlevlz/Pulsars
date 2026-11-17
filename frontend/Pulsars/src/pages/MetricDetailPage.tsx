import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { errorMessage } from "../api/client";
import { getTrend } from "../api/medic";
import type { Trend } from "../api/medic";
import { listLogs } from "../api/metrics";
import type { LogEntry, LogKind, MetricConfig, MetricId } from "../api/metrics";
import PageHeader from "../components/PageHeader";
import TrendChart from "../components/medic/TrendChart";
import EvidenceChip from "../components/metrics/EvidenceChip";
import TierBadge from "../components/metrics/TierBadge";
import { useMetricStatus } from "../hooks/useMetricStatus";
import { useMetricsConfig } from "../hooks/useMetricsConfig";
import { useSession } from "../hooks/useSession";
import { describeLog, formatLogTime } from "../lib/logs";
import { RANGES, describeLimit, formatValue, rangeById, vitalAccent } from "../lib/medic";
import type { RangeId } from "../lib/medic";
import { ageText, isMetricId } from "../lib/metrics";
import "../styles/Pulsars.css";
import "../styles/Medic.css";
import "../styles/Metrics.css";

/** The log each logged metric is made from (symptoms have their own page). */
const LOG_OF: Partial<Record<MetricId, LogKind>> = { bp: "bp", sleep: "sleep", orthostatic: "orthostatic" };

/** "Title: https://..." as a title and an address. */
function splitSource(source: string): { title: string; url: string | null } {
  const at = source.search(/:\s*https?:\/\//);
  if (at < 0) return { title: source, url: null };
  return { title: source.slice(0, at), url: source.slice(source.indexOf("http", at)) };
}

type Loaded<T> = { key: string; value: T };

/** The patient's own trend of one vital over a range, fetched when the range changes. */
function useOwnTrend(vital: "hr" | "bt" | "bo" | undefined, range: RangeId) {
  const session = useSession();
  const userId = session?.user.id;
  const key = `${userId}|${vital}|${range}`;
  const [loaded, setLoaded] = useState<Loaded<Trend> | null>(null);
  const [failure, setFailure] = useState<Loaded<string> | null>(null);

  useEffect(() => {
    if (userId === undefined || vital === undefined) return;
    const controller = new AbortController();
    const to = new Date();
    const from = new Date(to.getTime() - rangeById(range).ms);
    getTrend(userId, vital, from, to, controller.signal)
      .then((trend) => {
        setLoaded({ key, value: trend });
        setFailure(null);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setFailure({ key, value: errorMessage(err) });
      });
    return () => controller.abort();
  }, [userId, vital, range, key]);

  return {
    trend: loaded?.key === key ? loaded.value : null,
    error: failure?.key === key ? failure.value : null,
  };
}

/** The latest entries of the log a metric is made from. */
function useRecentLogs(kind: LogKind | undefined) {
  const [loaded, setLoaded] = useState<Loaded<LogEntry[]> | null>(null);
  const [failure, setFailure] = useState<Loaded<string> | null>(null);

  useEffect(() => {
    if (kind === undefined) return;
    const controller = new AbortController();
    listLogs(kind, 8, 0, controller.signal)
      .then((entries) => setLoaded({ key: kind, value: entries }))
      .catch((err) => {
        if (!controller.signal.aborted) setFailure({ key: kind, value: errorMessage(err) });
      });
    return () => controller.abort();
  }, [kind]);

  return {
    entries: kind !== undefined && loaded?.key === kind ? loaded.value : null,
    error: kind !== undefined && failure?.key === kind ? failure.value : null,
  };
}

export default function MetricDetailPage() {
  const { metricId } = useParams();
  const { config, error: configError } = useMetricsConfig();
  const health = useMetricStatus();
  const [range, setRange] = useState<RangeId>("7d");

  const metric: MetricConfig | undefined = isMetricId(metricId)
    ? config?.metrics.find((m) => m.metric_id === metricId)
    : undefined;
  const status = health.status?.metrics.find((m) => m.metricId === metricId) ?? null;
  const vital = metric?.vital;
  const { trend, error: trendError } = useOwnTrend(vital, range);
  const { entries, error: logsError } = useRecentLogs(isMetricId(metricId) ? LOG_OF[metricId] : undefined);
  const rangeInfo = rangeById(range);

  if (!isMetricId(metricId) || (config && !metric)) {
    return (
      <main className="pulsars">
        <PageHeader title="Metric not found" />
        <p>
          <Link to="/" className="tier-note__link">
            Back to the dashboard
          </Link>
        </p>
      </main>
    );
  }

  const problem = configError ?? health.error ?? trendError ?? logsError;

  return (
    <main className="pulsars">
      <PageHeader
        title={metric?.title ?? "Loading..."}
        subtitle={health.status ? `${health.status.profile.label}. ${health.status.disclaimer}` : undefined}
      />
      <p className="metric-detail__back">
        <Link to="/" className="tier-note__link">
          Back to the dashboard
        </Link>
      </p>

      {problem && (
        <p role="alert" className="notice">
          {problem}
        </p>
      )}

      {metric && (
        <div className="metric-detail">
          <div className="metric-detail__main">
            <section className={`card metric-tile metric-tile--${status?.level ?? "gray"}`} aria-labelledby="now-title">
              <header className="metric-tile__header">
                <h2 id="now-title" className="card__title card__title--lg">
                  Right now
                </h2>
                <TierBadge level={status?.level ?? "gray"} />
              </header>
              <p className="metric-tile__reading">
                <span className="metric-tile__value">{status?.display ?? "--"}</span>
                <span className="metric-tile__age">{status ? `Updated ${ageText(status)}` : ""}</span>
              </p>
              <p className="metric-detail__reason">{status?.reason ?? "Checking..."}</p>
              {status?.action && (
                <p className="metric-detail__reason">
                  <strong>What to do:</strong> {status.action}
                </p>
              )}
              <div className="tier-note__meta">
                <EvidenceChip level={metric.evidence_level} />
                {status?.baseline && <span className="tier-note__quality">{status.baseline.label}</span>}
                {status?.quality.note && <span className="tier-note__quality">{status.quality.note}</span>}
              </div>
            </section>

            {vital && (
              <section className="card" aria-labelledby="chart-title">
                <header className="medic-panel__head">
                  <h2 id="chart-title" className="card__title card__title--lg">
                    Trend
                  </h2>
                  <div className="segmented" role="group" aria-label="Time range">
                    {RANGES.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className={`segmented__btn${r.id === range ? " segmented__btn--on" : ""}`}
                        aria-pressed={r.id === range}
                        onClick={() => setRange(r.id)}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </header>
                {trend ? (
                  <>
                    <TrendChart
                      points={trend.points}
                      from={Date.parse(trend.from)}
                      to={Date.parse(trend.to)}
                      bucketMs={trend.bucketSeconds * 1000}
                      threshold={trend.threshold}
                      baseline={trend.baseline}
                      color={vitalAccent(vital)}
                      label={`${metric.title} over the ${rangeInfo.phrase}`}
                      formatValue={(value) => formatValue(vital, value)}
                    />
                    <div className="trend__axis" aria-hidden="true">
                      <span>{rangeInfo.ago}</span>
                      <span>now</span>
                    </div>
                    <p className="medic-vital__note">
                      {trend.points.length > 0
                        ? `${trend.points.length} points, each the average of its time slot.`
                        : "No readings in this range."}
                      {trend.threshold && <> Dashed line: {describeLimit(trend.threshold)}.</>}
                      {trend.baseline && <> Shaded band: your usual range.</>}
                    </p>
                  </>
                ) : (
                  <p className="history__empty">Loading...</p>
                )}
              </section>
            )}

            {LOG_OF[metric.metric_id] && (
              <section className="card" aria-labelledby="entries-title">
                <header className="medic-panel__head">
                  <h2 id="entries-title" className="card__title card__title--lg">
                    Latest entries
                  </h2>
                  <Link to="/health-log" className="tier-note__link">
                    Log one
                  </Link>
                </header>
                {entries === null ? (
                  <p className="history__empty">Loading...</p>
                ) : entries.length === 0 ? (
                  <p className="history__empty">Nothing logged yet.</p>
                ) : (
                  <ul className="history__list">
                    {entries.map((e) => (
                      <li key={e.id} className="history__item">
                        <div className="history__top">
                          <span className="history__symptom">{describeLog(e, config?.log_symptoms ?? [])}</span>
                          <time className="history__date" dateTime={e.recordedAt}>
                            {formatLogTime(e.recordedAt)}
                          </time>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {metric.metric_id === "symptoms" && (
              <section className="card">
                <h2 className="card__title card__title--lg">Your symptoms</h2>
                <p className="metric-detail__reason">
                  This tier comes from what you log in the symptom log.{" "}
                  <Link to="/symptom-log" className="tier-note__link">
                    Open the symptom log
                  </Link>
                </p>
              </section>
            )}
          </div>

          <aside className="metric-detail__side">
            <section className="card" aria-labelledby="explain-title">
              <h2 id="explain-title" className="card__title card__title--lg">
                About this check
              </h2>
              <dl className="explain">
                <dt>How to measure</dt>
                <dd>{metric.explain.how}</dd>
                <dt>What it means</dt>
                <dd>{metric.explain.meaning}</dd>
                <dt>Why it matters</dt>
                <dd>{metric.explain.why}</dd>
              </dl>
            </section>

            <section className="card" aria-labelledby="tiers-title">
              <h2 id="tiers-title" className="card__title card__title--lg">
                The tiers
              </h2>
              <ul className="tier-table">
                {(["green", "yellow", "red"] as const).map((level) => (
                  <li key={level} className="tier-table__row">
                    <TierBadge level={level} small />
                    <span>{metric.tiers[level]}</span>
                  </li>
                ))}
              </ul>
              <p className="medic-vital__note">{metric.persistence}</p>
              <p className="medic-vital__note">Baseline: {metric.baseline_rule}</p>
              {status === null || status.level === "gray" ? (
                <p className="medic-vital__note">Unknown means there is not enough fresh data to judge.</p>
              ) : null}
            </section>

            <section className="card" aria-labelledby="evidence-title">
              <h2 id="evidence-title" className="card__title card__title--lg">
                Where this comes from
              </h2>
              <p className="metric-detail__reason">
                <EvidenceChip level={metric.evidence_level} /> {metric.evidence_note}
              </p>
              <ul className="sources">
                {metric.sources.map((s) => {
                  const { title, url } = splitSource(s);
                  return (
                    <li key={s}>
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="tier-note__link sources__link">
                          {title}
                        </a>
                      ) : (
                        title
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="metric-detail__reason">
                <strong>Limitation:</strong> {metric.limitation}
              </p>
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}
