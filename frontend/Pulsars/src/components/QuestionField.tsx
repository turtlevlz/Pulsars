import { useId } from "react";
import type { Question } from "../lib/questionnaire";

type QuestionFieldProps = {
  question: Question;
  value: string;
  onChange: (value: string) => void;
};

function range(min: number, max: number) {
  const values: number[] = [];
  for (let n = min; n <= max; n++) values.push(n);
  return values;
}

export default function QuestionField({
  question,
  value,
  onChange,
}: QuestionFieldProps) {
  const groupName = useId();

  const renderControl = () => {
    switch (question.type) {
      case "scale":
        return (
          <div>
            <div className="severity">
              {range(question.min, question.max).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`severity__btn${String(n) === value ? " severity__btn--selected" : ""}`}
                  aria-pressed={String(n) === value}
                  onClick={() => onChange(String(n))}
                >
                  {n}
                </button>
              ))}
            </div>
            {(question.minLabel || question.maxLabel) && (
              <div className="scale__labels">
                <span>{question.minLabel}</span>
                <span>{question.maxLabel}</span>
              </div>
            )}
          </div>
        );

      case "choice":
        return (
          <div className="options">
            {question.options.map((option) => (
              <label
                key={option}
                className={`option${option === value ? " option--selected" : ""}`}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={option}
                  checked={option === value}
                  onChange={() => onChange(option)}
                />
                {option}
              </label>
            ))}
          </div>
        );

      case "number": {
        const hasRange = question.min !== undefined && question.max !== undefined;
        return (
          <div>
            <div className="numeric">
              <input
                type="number"
                className="field__control numeric__input"
                inputMode="decimal"
                step="any"
                min={question.min}
                max={question.max}
                value={value}
                aria-label={question.prompt}
                onChange={(e) => onChange(e.target.value)}
                autoFocus
              />
              {question.unit && (
                <span className="numeric__unit">{question.unit}</span>
              )}
            </div>
            {hasRange && (
              <p className="question__hint">
                Enter a value between {question.min} and {question.max}.
              </p>
            )}
          </div>
        );
      }

      case "text":
        return (
          <textarea
            className="field__control field__control--textarea"
            rows={4}
            placeholder={question.placeholder}
            value={value}
            aria-label={question.prompt}
            onChange={(e) => onChange(e.target.value)}
            autoFocus
          />
        );
    }
  };

  return (
    <fieldset className="question">
      <legend className="question__prompt">
        {question.prompt}
        {question.required === false && (
          <span className="question__optional"> (optional)</span>
        )}
      </legend>
      {renderControl()}
    </fieldset>
  );
}