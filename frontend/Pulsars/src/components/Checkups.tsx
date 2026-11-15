import { useId } from "react";
import type { Question } from "../lib/questionnaire";

export type Checkup = {
  id: string;
  title: string;
  /** Text shown in the badge, e.g. "Due Today" or "Due 11/11". */
  dueLabel: string;
  /** Text shown next to the clock, e.g. "About 5 min". */
  duration: string;
  completed: boolean;
  /** Highlights the badge for items due today. */
  dueToday?: boolean;
  /** Dims the row, used for older items. */
  past?: boolean;
  /** Steps shown on the first screen of the checkup modal. */
  instructions?: string[];
  /** Questions asked, one per screen, in the checkup modal. */
  questions?: Question[];
};

type CheckupsProps = {
  checkups: Checkup[];
  onStart?: (id: string) => void;
  onViewCompleted?: (id: string) => void;
  /** Card heading. Defaults to "Checkups". */
  title?: string;
  /** Shown when the list is empty. */
  emptyMessage?: string;
};

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function Checkups({
  checkups,
  onStart,
  onViewCompleted,
  title = "Checkups",
  emptyMessage = "Nothing here yet.",
}: CheckupsProps) {
  const titleId = useId();

  return (
    <section className="card checkups" aria-labelledby={titleId}>
      <h2 id={titleId} className="card__title card__title--lg">
        {title}
      </h2>

      {checkups.length === 0 ? (
        <p className="checkups__empty">{emptyMessage}</p>
      ) : (
        <ul className="checkups__list">
          {checkups.map((item) => (
            <li
              key={item.id}
              className={`checkup${item.past ? " checkup--past" : ""}`}
            >
              <div className="checkup__info">
                <div className="checkup__top">
                  <span className="checkup__title">{item.title}</span>
                  <span
                    className={`pill pill--sm${item.dueToday ? " pill--active" : ""}`}
                  >
                    {item.dueLabel}
                  </span>
                </div>
                <span className="checkup__duration">
                  <ClockIcon />
                  {item.duration}
                </span>
              </div>

              {item.completed && !onViewCompleted ? (
                <button type="button" className="btn btn--muted" disabled>
                  Completed
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--primary"
                  aria-label={item.completed ? `View ${item.title}` : undefined}
                  onClick={() => (item.completed ? onViewCompleted : onStart)?.(item.id)}
                >
                  {item.completed ? "View" : "Start"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
