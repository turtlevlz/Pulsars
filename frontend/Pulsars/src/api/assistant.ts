import { request, requestForUser } from "./client";

export type ThreadMessage = {
  id: number;
  role: "assistant" | "patient";
  content: string;
  createdAt: string;
};

export type Thread = {
  id: number;
  symptomId: number;
  /** "done" once the assistant has no more questions (or the question limit was reached). */
  status: "open" | "done";
  messages: ThreadMessage[];
};

type ThreadSummary = { id: number; status: "open" | "done" };

export type AnswerResult = {
  nextQuestion: string | null;
  done: boolean;
};

export function getThread(id: number, signal?: AbortSignal) {
  return request<Thread>(`/threads/${id}`, { signal });
}

/** The patient's most recent follow-up thread, or null if they have none. */
export async function getLatestThread(signal?: AbortSignal): Promise<ThreadSummary | null> {
  const threads = await requestForUser<ThreadSummary[]>("/threads?limit=1", {
    signal,
  });
  return threads[0] ?? null;
}

/**
 * Answers the assistant's latest question. The reply can take a while with a local model,
 * so this may be slow; the next question is read back with getThread().
 */
export function submitAnswer(threadId: number, answer: string) {
  return request<AnswerResult>(`/threads/${threadId}/messages`, {
    method: "POST",
    body: { answer },
  });
}
