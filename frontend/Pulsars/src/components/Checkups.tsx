import { useId } from "react";
import { Link } from "react-router-dom";
import type { Question } from "../lib/questionnaire";
import "../styles/Overview.css";

export type Checkup = {
  id: string;
  title: string;
  /** Text shown in the badge, e.g. "Due Today" or "Due 11/11". */
  dueLabel: string;
  /** Text shown next to the clock, e.g. "About 5 min". */
  duration: string;
  completed: boolean;
  /** Text shown for a finished checkup, e.g. "Done 11/14". */
  completedLabel?: string;
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
  /**
   * "list" (the default) is one plain list. "overview" is the dashboard card: a progress strip,
   * the to-do list, and a "Completed" section that takes whatever height the card is given
   * and hides itself when there is none, so the card never has a blank stretch in it.
   */
  variant?: "list" | "overview";
  /** Overview only: where the "View all checkups" link goes. */
  viewAllTo?: string;
};

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path
        d="m8 12.5 2.8 2.8L16 9.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type RowProps = {
  item: Checkup;
  onStart?: (id: string) => void;
  onViewCompleted?: (id: string) => void;
  /** Show the first instruction line under the title. */
  summary?: boolean;
};

function CheckupRow({ item, onStart, onViewCompleted, summary }: RowProps) {
  const firstStep = summary ? item.instructions?.[0] : undefined;

  return (
    <li className={`checkup${item.past ? " checkup--past" : ""}`}>
      <div className="checkup__info">
        <div className="checkup__top">
          <span className="checkup__title">{item.title}</span>
          <span className={`pill pill--sm${item.dueToday ? " pill--active" : ""}`}>
            {item.dueLabel}
          </span>
        </div>
        {firstStep && <span className="checkup__summary">{firstStep}</span>}
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
  );
}

function CheckupsOverview({
  checkups,
  onStart,
  title = "Checkups",
  emptyMessage = "Nothing here yet.",
  viewAllTo,
}: CheckupsProps) {
  const titleId = useId();
  const todo = checkups.filter((c) => !c.completed);
  const done = checkups.filter((c) => c.completed);
  const percent = checkups.length ? Math.round((done.length / checkups.length) * 100) : 0;

  return (
    <section className="card checkups checkups--overview" aria-labelledby={titleId}>
      <div className="checkups__head">
        <h2 id={titleId} className="card__title card__title--lg">
          {title}
        </h2>
        {checkups.length > 0 && (
          <span className="checkups__count">
            {done.length} of {checkups.length} done
          </span>
        )}
      </div>

      {checkups.length === 0 ? (
        // Nothing to lay out: the message itself fills the card
        <p className="checkups__empty checkups__empty--fill">{emptyMessage}</p>
      ) : (
        <>
          <div
            className="progress checkups__progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="Checkups completed"
          >
            <div className="progress__fill" style={{ width: `${percent}%` }} />
          </div>

          {todo.length > 0 ? (
            <ul className="checkups__list">
              {todo.map((item) => (
                <CheckupRow key={item.id} item={item} onStart={onStart} summary />
              ))}
            </ul>
          ) : (
            <p className="checkups__clear">
              <CheckIcon size={18} />
              You are all caught up.
            </p>
          )}

          <div className="checkups__done">
            <div className="checkups__done-body">
              <h3 className="checkups__subtitle">Completed</h3>
              {done.length > 0 ? (
                <ul className="checkups__done-list">
                  {done.map((item) => (
                    <li key={item.id} className="checkups__done-item">
                      <CheckIcon />
                      <span className="checkups__done-title">{item.title}</span>
                      <span className="checkups__done-date">{item.completedLabel ?? "Done"}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="checkups__done-empty">
                  <CheckIcon size={26} />
                  <p>No completed checkups yet.</p>
                  <p className="checkups__done-hint">
                    Finish one and it will be listed here with the date.
                  </p>
                </div>
              )}
            </div>
          </div>

          {viewAllTo && (
            <Link className="checkups__more" to={viewAllTo}>
              View all checkups
            </Link>
          )}
        </>
      )}
    </section>
  );
}

export default function Checkups(props: CheckupsProps) {
  if (props.variant === "overview") return <CheckupsOverview {...props} />;
  return <CheckupsList {...props} />;
}

function CheckupsList({
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
            <CheckupRow
              key={item.id}
              item={item}
              onStart={onStart}
              onViewCompleted={onViewCompleted}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
