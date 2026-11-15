import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../components/HealthAssistant";
import { getLatestThread, getThread, submitAnswer } from "../api/assistant";
import type { Thread } from "../api/assistant";
import { errorMessage } from "../api/client";

const POLL_MS = 1000;
/** Gives a slow local model about three minutes to produce a question. */
const MAX_POLLS = 180;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toChatMessage = (m: Thread["messages"][number]): ChatMessage => ({
  id: String(m.id),
  from: m.role === "assistant" ? "assistant" : "user",
  text: m.content,
});

/**
 * The follow-up conversation for the patient's most recent logged symptom.
 *
 * The backend's assistant asks questions about a symptom and the patient answers them,
 * so the chat box is where those answers go. The thread on the server is the source of
 * truth: after every step the whole thread is read back instead of being tracked here.
 */
export function useAssistant() {
  const [threadId, setThreadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [closed, setClosed] = useState(false);
  /** True while we wait for the assistant to produce its next question. */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every action takes a new token. An older action that finds the token changed (a newer
  // action started, or the page was left) stops without touching state.
  const session = useRef(0);
  const invalidate = useCallback(() => {
    session.current++;
  }, []);

  const apply = useCallback((thread: Thread) => {
    setMessages(thread.messages.map(toChatMessage));
    setClosed(thread.status === "done");
  }, []);

  /** Reads the thread until the assistant has spoken last (or the thread is done). */
  const waitForAssistant = useCallback(async (id: number, token: number) => {
    try {
      for (let i = 0; i < MAX_POLLS; i++) {
        const thread = await getThread(id);
        if (token !== session.current) return;
        apply(thread);

        const last = thread.messages.at(-1);
        if (thread.status === "done" || last?.role === "assistant") return;

        setBusy(true);
        await sleep(POLL_MS);
        if (token !== session.current) return;
      }
      setError("The assistant is taking longer than usual. Reload to check again.");
    } catch (err) {
      if (token === session.current) setError(errorMessage(err));
    } finally {
      if (token === session.current) setBusy(false);
    }
  }, [apply]);

  // Pick up the latest thread when the page opens (resumes one that is still being answered)
  useEffect(() => {
    const token = ++session.current;
    const run = async () => {
      try {
        const latest = await getLatestThread();
        if (token !== session.current || !latest) return;
        setThreadId(latest.id);
        await waitForAssistant(latest.id, token);
      } catch (err) {
        if (token === session.current) setError(errorMessage(err));
      }
    };
    void run();
    return invalidate; // leaving the page cancels any polling still in flight
  }, [waitForAssistant, invalidate]);

  /** Switches to the thread opened by a freshly logged symptom. */
  const follow = useCallback(
    (id: number | null) => {
      const token = ++session.current;
      setError(null);
      if (id === null) return; // the backend could not open a thread for this symptom
      setThreadId(id);
      setMessages([]);
      setClosed(false);
      setBusy(true);
      void waitForAssistant(id, token);
    },
    [waitForAssistant],
  );

  /** Sends the patient's answer, then reads back the assistant's next question. */
  const send = useCallback(
    async (text: string) => {
      if (threadId === null || busy || closed) return;
      const token = ++session.current;
      const pendingId = `pending-${token}`;

      setError(null);
      setBusy(true);
      setMessages((prev) => [...prev, { id: pendingId, from: "user", text }]);

      try {
        await submitAnswer(threadId, text);
        const thread = await getThread(threadId);
        if (token !== session.current) return;
        apply(thread);
      } catch (err) {
        if (token !== session.current) return;
        setMessages((prev) => prev.filter((m) => m.id !== pendingId));
        setError(errorMessage(err));
      } finally {
        if (token === session.current) setBusy(false);
      }
    },
    [threadId, busy, closed, apply],
  );

  return { threadId, messages, closed, busy, error, follow, send };
}
