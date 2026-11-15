import { useId } from "react";
import { MOTION_LEVELS, type TimedReading, type TimelineEvent } from "../api/fitness";
import { formatDuration, formatTime, levelLabels } from "../lib/fitness";

function At({ value }: { value: string }) {
  return <time dateTime={value}>{formatTime(value)}</time>;
}

function SensorValue({ reading, unit }: { reading: TimedReading | null; unit: string }) {
  if (!reading) return <span className="fitness-muted">Unavailable</span>;
  const value = unit === "bpm" ? Math.round(reading.value) : reading.value.toFixed(1);
  return (
    <span>
      <strong>{value} {unit}</strong>
      <span className="fitness-muted"> at <At value={reading.recordedAt} />
        {reading.relation !== "during" && ` (${reading.relation} activity)`}
      </span>
    </span>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  if (event.kind === "routine") {
    return (
      <div className="fitness-event fitness-event--routine">
        <span className="fitness-event__marker" aria-hidden="true">✓</span>
        <div><strong>{event.title} completed</strong><small><At value={event.completedAt} /></small></div>
      </div>
    );
  }

  const range = <><At value={event.startedAt} /> – <At value={event.endedAt} /></>;
  if (event.kind === "gap") {
    return (
      <div className="fitness-event fitness-event--gap">
        <span className="fitness-event__marker" aria-hidden="true" />
        <div><strong>Motion data unavailable</strong><small>{range}</small></div>
      </div>
    );
  }
  const active = event.kind === "activity";
  const title = active ? `${levelLabels[event.band]} motion` : "No sustained motion";
  const marker = active ? `fitness-band--${event.band}` : "fitness-band--quiet";
  return (
    <details className="fitness-event">
      <summary className="fitness-event__summary">
        <span className={`fitness-event__marker ${marker}`} aria-hidden="true" />
        <span className="fitness-event__name"><strong>{title}</strong><small>{range}</small></span>
        {active && <span className="fitness-event__duration">{formatDuration(event.activeSeconds)}</span>}
      </summary>
      <div className="fitness-event__detail">
        {active && (
          <ul className="fitness-calendar__legend">
            {MOTION_LEVELS.filter(level => event.intensity[level] > 0).map(level => (
              <li key={level}><span className={`fitness-dot fitness-band--${level}`} />
                {levelLabels[level]} {formatDuration(event.intensity[level])}
              </li>
            ))}
          </ul>
        )}
        <dl className="fitness-event__sensors">
          <dt>Pulse</dt><dd><SensorValue reading={event.pulse} unit="bpm" /></dd>
          <dt>Forearm skin temperature</dt><dd><SensorValue reading={event.skinTemperature} unit="°C" /></dd>
        </dl>
      </div>
    </details>
  );
}

export default function FitnessTimeline({ timeline, loading }: { timeline: TimelineEvent[]; loading: boolean }) {
  const heading = useId();
  return (
    <section className="card fitness-timeline" aria-labelledby={heading}>
      <h2 id={heading} className="card__title card__title--lg">Activity Timeline</h2>
      {timeline.length ? (
        <ol className="fitness-timeline__list">
          {timeline.map(event => (
            <li key={event.kind === "routine" ? event.routineKey + event.completedAt : event.kind + event.startedAt}>
              <TimelineRow event={event} />
            </li>
          ))}
        </ol>
      ) : <p className="fitness-muted">{loading ? "Loading activity…" : "No activity or routine completions recorded for this day."}</p>}
    </section>
  );
}
