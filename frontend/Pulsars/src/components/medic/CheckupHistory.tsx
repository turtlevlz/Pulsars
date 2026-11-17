import type { CheckupSummary } from "../../api/checkups";
import { sortCheckups } from "../../api/checkups";
import { checkupState } from "../../lib/medic";

export default function CheckupHistory({ checkups, now }: { checkups: CheckupSummary[]; now: number }) {
  return (
    <section className="card medic-checkups" aria-labelledby="checkup-history-title">
      <h2 id="checkup-history-title" className="card__title card__title--lg">
        Checkup history
      </h2>
      {checkups.length === 0 ? (
        <p className="history__empty">You haven't assigned this patient a check-up yet.</p>
      ) : (
        <ul className="medic-checkups__list">
          {sortCheckups(checkups).map((c) => {
            const state = checkupState(c, now);
            return (
              <li key={c.id} className="medic-checkups__item">
                <span className="medic-checkups__name">
                  {c.name}
                  <span className="medic-checkups__progress">
                    {c.answeredCount}/{c.questionCount} answered
                  </span>
                </span>
                <span className={`chip chip--${state.tone}`}>{state.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
