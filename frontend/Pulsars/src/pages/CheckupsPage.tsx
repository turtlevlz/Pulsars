import PageHeader from "../components/PageHeader";
import Checkups from "../components/Checkups";
import CheckupModal from "../components/CheckupModal";
import { useCheckups } from "../hooks/useCheckups";
import "../styles/Pulsars.css";

export default function CheckupsPage() {
  const { checkups, activeCheckup, startCheckup, closeCheckup, completeCheckup } =
    useCheckups();

  const todo = checkups.filter((c) => !c.completed);
  const done = checkups.filter((c) => c.completed);
  const percent = checkups.length
    ? Math.round((done.length / checkups.length) * 100)
    : 0;

  return (
    <main className="pulsars">
      <PageHeader
        title="Checkups"
        subtitle="Keep up with your routine health checks."
      />

      <section className="card summary" aria-label="Checkup progress">
        <div className="summary__row">
          <p className="summary__count">
            {done.length} of {checkups.length} <span>completed</span>
          </p>
          <p className="summary__next">
            {todo.length > 0
              ? `Next up: ${todo[0].title}`
              : "You are all caught up."}
          </p>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Checkups completed"
        >
          <div className="progress__fill" style={{ width: `${percent}%` }} />
        </div>
      </section>

      <div className="split">
        <Checkups
          title="To do"
          checkups={todo}
          onStart={startCheckup}
          emptyMessage="Nothing left to do. Nice work."
        />
        <Checkups
          title="Completed"
          checkups={done}
          emptyMessage="No completed checkups yet."
        />
      </div>

      {activeCheckup && (
        <CheckupModal
          key={activeCheckup.id}
          checkup={activeCheckup}
          onClose={closeCheckup}
          onComplete={completeCheckup}
        />
      )}
    </main>
  );
}