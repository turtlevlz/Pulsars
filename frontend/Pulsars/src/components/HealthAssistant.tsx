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
};

export default function HealthAssistant({
  messages,
  onSend,
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
    if (!text) return;
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
            Explains your data and asks questions. It does not give medical
            advice.
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
        {messages.map((message) => (
          <p
            key={message.id}
            className={`bubble bubble--${message.from}`}
          >
            {message.text}
          </p>
        ))}
        <div ref={endRef} />
      </div>

      <form className="assistant__composer" onSubmit={handleSubmit}>
        <input
          type="text"
          className="assistant__input"
          placeholder="Ask about your data..."
          aria-label="Ask about your data"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
        />
        <button type="submit" className="btn btn--primary">
          Send
        </button>
      </form>
    </section>
  );
}