import { useEffect, useState } from "react";
import { errorMessage } from "../api/client";
import {
  finishRoutine, getCalendar, getDay, getRoutines, MOTION_LEVELS,
  type FitnessCalendar as CalendarData, type FitnessDay, type Routine, type Routines,
} from "../api/fitness";
import Checkups from "../components/Checkups";
import FitnessCalendar from "../components/FitnessCalendar";
import FitnessTimeline from "../components/FitnessTimeline";
import PageHeader from "../components/PageHeader";
import RoutineModal from "../components/RoutineModal";
import { civilDate, dateKey, formatDuration, formatTime, levelLabels } from "../lib/fitness";
import "../styles/Pulsars.css";
import "../styles/Fitness.css";

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
const pollMs = 5000;

function DaySummary({ date, day, loading }: { date: string; day?: FitnessDay; loading: boolean }) {
  const label = civilDate(date).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });
  return (
    <section className="card fitness-summary" aria-labelledby="fitness-day-heading">
      <h2 id="fitness-day-heading" className="card__title">{label}</h2>
      {!day ? <p className="fitness-muted">{loading ? "Loading activity…" : "Could not load this day."}</p>
        : day.trackedSeconds === 0 ? <p className="fitness-muted">No motion data was recorded for this day.</p>
        : (
          <>
            <p>
              The cuff detected <strong>{formatDuration(day.activeSeconds)} of activity</strong> during{" "}
              {formatDuration(day.trackedSeconds)} of recorded motion data.
            </p>
            {day.activeSeconds > 0
              ? <ul className="fitness-calendar__legend">
                {MOTION_LEVELS.map(level => (
                  <li key={level}>
                    <span className={`fitness-dot fitness-band--${level}`} />{levelLabels[level]} {formatDuration(day.intensity[level])}
                  </li>
                ))}
              </ul>
              : <p className="fitness-muted">No sustained motion was detected.</p>}
          </>
        )}
    </section>
  );
}

export default function FitnessPage() {
  const [now, setNow] = useState(() => new Date());
  const [selected, setSelected] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<CalendarData>();
  const [day, setDay] = useState<FitnessDay>();
  const [routineList, setRoutineList] = useState<Routines>();
  const [activeRoutine, setActiveRoutine] = useState<Routine | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [routineError, setRoutineError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const today = dateKey(now);
  const date = selected ?? today;
  const month = date.slice(0, 7);
  const followingToday = date === today;

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), pollMs);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getCalendar(month, timeZone, controller.signal).then(result => {
      setCalendar(result);
      setCalendarError(null);
    }).catch(error => {
      if (!controller.signal.aborted) setCalendarError(errorMessage(error));
    });
    return () => controller.abort();
  }, [month]);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const result = await getDay(date, timeZone, controller.signal);
        if (controller.signal.aborted) return;
        setDay(result);
        setDayError(null);
        setCalendar(previous => {
          if (previous?.month !== month || !result.trackedSeconds) return previous;
          const { date, trackedSeconds, activeSeconds, intensity } = result;
          return { ...previous, days: [...previous.days.filter(day => day.date !== date), { date, trackedSeconds, activeSeconds, intensity }] };
        });
      } catch (error) {
        if (!controller.signal.aborted) setDayError(errorMessage(error));
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = followingToday ? window.setInterval(refresh, pollMs) : undefined;
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [date, month, followingToday, revision]);

  useEffect(() => {
    const controller = new AbortController();
    void getRoutines(timeZone, controller.signal).then(result => {
      setRoutineList(result);
      setRoutineError(null);
    }).catch(error => {
      if (!controller.signal.aborted) setRoutineError(errorMessage(error));
    });
    return () => controller.abort();
  }, [today, revision]);

  const currentDay = day?.date === date ? day : undefined;
  const calendarDays = calendar?.month === month ? calendar.days : [];
  const days = currentDay?.trackedSeconds
    ? [...calendarDays.filter(item => item.date !== date), currentDay] : calendarDays;
  const routines = routineList?.date === today ? routineList.routines : [];
  const lastSeen = currentDay?.lastReadingAt;
  const age = lastSeen ? now.getTime() - new Date(lastSeen).getTime() : Infinity;
  const live = age >= -pollMs && age < 25_000;
  const problem = dayError ?? calendarError ?? routineError;

  async function complete(key: string) {
    await finishRoutine(key, timeZone);
    setActiveRoutine(null);
    setRevision(value => value + 1);
  }

  return (
    <main className="pulsars fitness">
      <div className="fitness-header">
        <PageHeader title="Fitness" />
        {followingToday && currentDay && (
          <p className="fitness-status" role="status">
            {live ? <><span aria-hidden="true" /> Receiving cuff data</> : lastSeen
              ? <>Last device data <time dateTime={lastSeen}>
                {dateKey(new Date(lastSeen)) === today ? formatTime(lastSeen) : new Date(lastSeen).toLocaleString()}
              </time></> : "Waiting for USB cuff data"}
          </p>
        )}
      </div>
      {problem && <p role="alert" className="notice">{problem}</p>}
      <div className="fitness-layout">
        <div className="fitness-column">
          <FitnessCalendar month={month} date={date} today={today} days={days}
            onSelect={value => setSelected(value === today ? null : value)} />
          <DaySummary date={date} day={currentDay} loading={!dayError} />
        </div>
        <div className="fitness-column">
          <Checkups title="Routines" emptyMessage={routineError ? "Could not load routines." : "Loading routines…"}
            checkups={routines.map(routine => ({
              id: routine.key, title: routine.title, dueLabel: routine.category, duration: routine.duration,
              completed: !!routine.completedAt,
            }))}
            onStart={key => setActiveRoutine(routines.find(routine => routine.key === key) ?? null)} />
          <FitnessTimeline timeline={currentDay?.timeline ?? []} loading={!currentDay && !dayError} />
        </div>
      </div>
      {activeRoutine && (
        <RoutineModal key={activeRoutine.key} routine={activeRoutine} onComplete={complete}
          onClose={() => setActiveRoutine(null)} />
      )}
    </main>
  );
}
