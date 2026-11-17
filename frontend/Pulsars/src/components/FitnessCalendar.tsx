import { useId } from "react";
import { MOTION_LEVELS, type ActivityTotals } from "../api/fitness";
import { civilDate, formatDuration, levelLabels, shiftMonth } from "../lib/fitness";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = {
  month: string;
  date: string;
  today: string;
  days: ActivityTotals[];
  onSelect: (date: string) => void;
};

function compactDuration(seconds: number) {
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)}h`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${seconds}s`;
}

export default function FitnessCalendar({ month, date, today, days, onSelect }: Props) {
  const heading = useId();
  const first = civilDate(`${month}-01`);
  const monthLabel = first.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const startOffset = first.getUTCDay();
  const end = civilDate(`${shiftMonth(month, 1)}-01`);
  end.setUTCDate(0);
  const lastDay = end.getUTCDate();
  const gridSize = Math.ceil((startOffset + lastDay) / 7) * 7;
  const summaries = new Map(days.map(info => [info.date, info]));
  const moveMonth = (offset: number) => {
    const next = shiftMonth(month, offset);
    onSelect(today.startsWith(next) ? today : `${next}-01`);
  };

  return (
    <section className="card fitness-calendar" aria-labelledby={heading}>
      <h2 id={heading} className="card__title card__title--lg">Activity Calendar</h2>
      <div className="fitness-calendar__nav">
        <div className="fitness-calendar__month">
          <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}>‹</button>
          <span aria-live="polite">{monthLabel}</span>
          <button type="button" aria-label="Next month" onClick={() => moveMonth(1)}>›</button>
        </div>
        <button type="button" className="fitness-calendar__today" onClick={() => onSelect(today)}>Today</button>
      </div>
      <div className="fitness-calendar__grid">
        {weekdays.map(day => <span key={day} className="fitness-calendar__weekday">{day}</span>)}
        {Array.from({ length: gridSize }, (_, index) => {
          const day = index - startOffset + 1;
          if (day < 1 || day > lastDay) return <span key={index} aria-hidden="true" />;
          const key = `${month}-${String(day).padStart(2, "0")}`;
          const info = summaries.get(key);
          const tracked = !!info?.trackedSeconds;
          const description = civilDate(key).toLocaleDateString(undefined, { dateStyle: "full", timeZone: "UTC" });
          const activity = tracked ? `${formatDuration(info.activeSeconds)} active` : "No motion data";
          const levels = info ? MOTION_LEVELS.filter(level => info.intensity[level] > 0)
            .map(level => `${levelLabels[level]} ${formatDuration(info.intensity[level])}`).join(", ") : "";
          return (
            <button type="button" key={index} className="fitness-date" aria-pressed={key === date}
              aria-current={key === today ? "date" : undefined}
              aria-label={[description, activity, levels].filter(Boolean).join(", ")} onClick={() => onSelect(key)}>
              <span>{day}</span>
              <span className="fitness-date__duration" aria-hidden="true">{tracked ? compactDuration(info.activeSeconds) : "—"}</span>
              {tracked && (
                <span className="fitness-date__bands" aria-hidden="true">
                  {!info.activeSeconds && <span className="fitness-band fitness-band--quiet" />}
                  {MOTION_LEVELS.filter(level => info.intensity[level] > 0).map(level => (
                    <span key={level} className={`fitness-band fitness-band--${level}`} style={{ flexGrow: info.intensity[level] }} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <ul className="fitness-calendar__legend" aria-label="Calendar legend">
        {MOTION_LEVELS.map(level => (
          <li key={level}><span className={`fitness-dot fitness-band--${level}`} />{levelLabels[level]}</li>
        ))}
        <li><span className="fitness-dot fitness-band--quiet" />Quiet</li>
        <li>— No motion data</li>
      </ul>
    </section>
  );
}
