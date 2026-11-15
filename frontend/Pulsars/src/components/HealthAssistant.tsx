import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import StarMascot from "./StarMascot";

export type ChatMessage = {
  id: string;
  from: "assistant" | "user";
  text: string;
};

type HealthAssistantProps = {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  /** Waiting for the assistant to write its next message. */
  busy?: boolean;
  /** Turns the input off, e.g. when there is no question to answer. */
  disabled?: boolean;
  placeholder?: string;
  /** Shown instead of the conversation while there are no messages. */
  emptyText?: string;
  error?: string | null;
};

export default function HealthAssistant({
  messages,
  onSend,
  busy = false,
  disabled = false,
  placeholder = "Ask about your data...",
  emptyText,
  error,
}: HealthAssistantProps) {
  const [draft, setDraft] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || disabled) return;
    onSend(text);
    setDraft("");
  };

  return (
    <section className="card assistant" aria-labelledby="assistant-title">
      <header className="assistant__header">
        <div className="assistant__heading">
          <div className="assistant__title-row">
            <h2 id="assistant-title" className="card__title card__title--lg">
              Health Assistant
            </h2>
            <span className="pill pill--sm">AI</span>
          </div>
          <p className="assistant__disclaimer">
            Asks follow-up questions about the symptoms you log. It does not
            give medical advice.
          </p>
        </div>

        <StarMascot lookDown={inputFocused} size={84} className="assistant__mascot" />
      </header>

      <div
        className="assistant__messages"
        role="log"
        aria-live="polite"
        aria-label="Conversation with the health assistant"
      >
        {messages.length === 0 && !busy && emptyText && (
          <p className="assistant__empty">{emptyText}</p>
        )}
        {messages.map((message) => (
          <p
            key={message.id}
            className={`bubble bubble--${message.from}`}
          >
            {message.text}
          </p>
        ))}
        {busy && (
          <p className="bubble bubble--assistant bubble--typing">Thinking...</p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form className="assistant__composer" onSubmit={handleSubmit}>
        <input
          type="text"
          className="assistant__input"
          placeholder={placeholder}
          aria-label={placeholder}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
        />
        <button type="submit" className="btn btn--primary" disabled={disabled}>
          Send
        </button>
      </form>
    </section>
  );
}