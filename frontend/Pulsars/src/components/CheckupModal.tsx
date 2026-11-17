import { useId, useState } from "react";
import type { FormEvent } from "react";
import Modal from "./Modal";
import QuestionField from "./QuestionField";
import type { Checkup } from "./Checkups";
import { isAnswered, toAnswers } from "../lib/questionnaire";
import type { CheckupAnswers, RawAnswers } from "../lib/questionnaire";
import { errorMessage } from "../api/client";

type CheckupModalProps = {
  checkup: Checkup;
  onClose: () => void;
  /** May be async. If it throws, the message is shown and the modal stays open. */
  onComplete: (id: string, answers: CheckupAnswers) => void | Promise<void>;
};

export default function CheckupModal({
  checkup,
  onClose,
  onComplete,
}: CheckupModalProps) {
  const titleId = useId();
  const instructions = checkup.instructions ?? [];
  const questions = checkup.questions ?? [];
  const total = questions.length;

  // Step 0 is the instructions screen, steps 1..total are the questions
  const [step, setStep] = useState(0);
  const [raw, setRaw] = useState<RawAnswers>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onIntro = step === 0;
  const isLast = step === total;
  const question = onIntro ? null : questions[step - 1];
  const canContinue = question ? isAnswered(question, raw[question.id]) : true;

  const nextLabel = onIntro && total > 0
    ? "Begin"
    : isLast
      ? total === 0
        ? "Mark as done"
        : "Finish"
      : "Next";

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canContinue || submitting) return;

    if (!isLast) {
      setStep((s) => s + 1);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onComplete(checkup.id, toAnswers(questions, raw));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose} labelledBy={titleId} dismissOnBackdrop={false}>
      <form className="modal__panel" onSubmit={handleSubmit}>
        <header className="modal__header">
          <div>
            <h2 id={titleId} className="modal__title">
              {checkup.title}
            </h2>
            <p className="modal__meta">{checkup.duration}</p>
          </div>
          <button
            type="button"
            className="modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="modal__body">
          {onIntro ? (
            <>
              <h3 className="modal__subtitle">Before you start</h3>
              {instructions.length > 0 ? (
                <ol className="instructions">
                  {instructions.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ol>
              ) : (
                <p className="modal__note">Follow your usual routine for this check.</p>
              )}
              {total > 0 && (
                <p className="modal__note">
                  {total} {total === 1 ? "question" : "questions"} to answer.
                </p>
              )}
            </>
          ) : (
            question && (
              <>
                <div className="modal__progress">
                  <span className="modal__progress-label">
                    Question {step} of {total}
                  </span>
                  <div
                    className="progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={total}
                    aria-valuenow={step}
                    aria-label="Questionnaire progress"
                  >
                    <div
                      className="progress__fill"
                      style={{ width: `${(step / total) * 100}%` }}
                    />
                  </div>
                </div>

                <QuestionField
                  key={question.id}
                  question={question}
                  value={raw[question.id] ?? ""}
                  onChange={(value) =>
                    setRaw((prev) => ({ ...prev, [question.id]: value }))
                  }
                />
              </>
            )
          )}

          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>

        <footer className="modal__footer">
          {onIntro ? (
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={submitting}
              onClick={() => setStep((s) => s - 1)}
            >
              Back
            </button>
          )}

          <button
            type="submit"
            className="btn btn--primary"
            disabled={!canContinue || submitting}
          >
            {submitting ? "Saving..." : nextLabel}
          </button>
        </footer>
      </form>
    </Modal>
  );
}