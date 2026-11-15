import type { Checkup } from "../components/Checkups";
import type { CheckupAnswers } from "../lib/questionnaire";
import { request, USER_ID } from "./client";

type CheckupStatus = "assigned" | "completed";

/** One row of GET /users/:id/checkups (no questions, just counts). */
export type CheckupSummary = {
  id: number;
  name: string;
  description: string | null;
  status: CheckupStatus;
  /** ISO timestamp, or null when the medic set no due date. */
  dueAt: string | null;
  assignedAt: string;
  completedAt: string | null;
  questionCount: number;
  answeredCount: number;
};

/** GET /checkups/:id, including the questions. */
export type CheckupDetail = Omit<CheckupSummary, "questionCount" | "answeredCount"> & {
  questions: { id: number; question: string; answer: string | null }[];
};

export function listCheckups(signal?: AbortSignal) {
  return request<CheckupSummary[]>(`/users/${USER_ID}/checkups?limit=100`, {
    signal,
  });
}

export function getCheckup(id: string) {
  return request<CheckupDetail>(`/checkups/${id}`);
}

/** Saves one answer per question; the backend marks the check-up completed once all are in. */
export function submitAnswers(id: string, answers: CheckupAnswers) {
  return request<CheckupDetail>(`/checkups/${id}/answers`, {
    method: "PUT",
    body: {
      answers: Object.entries(answers).map(([questionId, answer]) => ({
        questionId: Number(questionId),
        answer: String(answer),
      })),
    },
  });
}

// ---------------------------------------------------------------- backend -> UI shape

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function dueFields(dueAt: string | null, completed: boolean) {
  if (!dueAt) return { dueLabel: "No due date", dueToday: false, past: false };

  const due = new Date(dueAt);
  const now = new Date();
  const today = sameDay(due, now);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return {
    dueLabel: today ? "Due Today" : `Due ${due.getMonth() + 1}/${due.getDate()}`,
    dueToday: today && !completed,
    // Older completed items are dimmed
    past: completed && due < startOfToday,
  };
}

/**
 * The backend stores a question as free text and an answer as a string, so every
 * question becomes a text question here. (The UI also supports scale, choice and number
 * questions, but the backend has nowhere to keep their type or options yet.)
 */
export function toCheckup(c: CheckupSummary | CheckupDetail): Checkup {
  const completed = c.status === "completed";
  const count = "questions" in c ? c.questions.length : c.questionCount;

  return {
    id: String(c.id),
    title: c.name,
    ...dueFields(c.dueAt, completed),
    duration: `${count} ${count === 1 ? "question" : "questions"}`,
    completed,
    // The description is free text; a line per step on the "Before you start" screen
    instructions: c.description
      ?.split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    questions:
      "questions" in c
        ? c.questions.map((q) => ({
            id: String(q.id),
            type: "text" as const,
            prompt: q.question,
            placeholder: "Type your answer",
          }))
        : undefined,
  };
}

/** To do first (soonest due first, undated last), then completed (most recent first). */
export function sortCheckups(rows: CheckupSummary[]): CheckupSummary[] {
  const key = (c: CheckupSummary): [number, number] =>
    c.status === "completed"
      ? [1, -Date.parse(c.completedAt ?? c.assignedAt)]
      : [0, c.dueAt ? Date.parse(c.dueAt) : Infinity];

  return [...rows].sort((a, b) => {
    const [ra, ta] = key(a);
    const [rb, tb] = key(b);
    if (ra !== rb) return ra - rb;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}
