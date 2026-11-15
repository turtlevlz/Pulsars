/**
 * Question definitions for checkups.
 *
 * To add a new question type:
 *  1. Add a new member to the `Question` union below.
 *  2. Add a `case` for it in `QuestionField.tsx`.
 *  3. Handle any special validation in `isAnswered` and any conversion in `toAnswers`.
 */

type BaseQuestion = {
  id: string;
  prompt: string;
  /** Questions are required unless this is set to false. */
  required?: boolean;
};

export type ScaleQuestion = BaseQuestion & {
  type: "scale";
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
};

export type ChoiceQuestion = BaseQuestion & {
  type: "choice";
  options: string[];
};

export type NumberQuestion = BaseQuestion & {
  type: "number";
  unit?: string;
  min?: number;
  max?: number;
};

export type TextQuestion = BaseQuestion & {
  type: "text";
  placeholder?: string;
};

export type Question =
  | ScaleQuestion
  | ChoiceQuestion
  | NumberQuestion
  | TextQuestion;

/** What the modal keeps while the person is answering: everything is a string. */
export type RawAnswers = Record<string, string>;

/** What gets handed back on completion: numbers for number and scale questions. */
export type CheckupAnswers = Record<string, string | number>;

export function isAnswered(question: Question, value = ""): boolean {
  const trimmed = value.trim();

  if (trimmed === "") return question.required === false;

  if (question.type === "number") {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return false;
    if (question.min !== undefined && n < question.min) return false;
    if (question.max !== undefined && n > question.max) return false;
  }

  return true;
}

export function toAnswers(
  questions: Question[],
  raw: RawAnswers,
): CheckupAnswers {
  const answers: CheckupAnswers = {};

  for (const question of questions) {
    const value = raw[question.id]?.trim();
    if (!value) continue;
    answers[question.id] =
      question.type === "number" || question.type === "scale"
        ? Number(value)
        : value;
  }

  return answers;
}