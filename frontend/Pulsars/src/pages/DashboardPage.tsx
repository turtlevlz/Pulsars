import { useState } from "react";
import VitalCard from "../components/VitalCard";
import type { VitalStatus } from "../components/VitalCard";
import Checkups from "../components/Checkups";
import CheckupModal from "../components/CheckupModal";
import SymptomLog from "../components/SymptomLog";
import type { SymptomEntry } from "../components/SymptomLog";
import HealthAssistant from "../components/HealthAssistant";
import type { ChatMessage } from "../components/HealthAssistant";
import { useCheckups } from "../hooks/useCheckups";
import "../styles/Pulsars.css";

type Vital = {
  id: string;
  label: string;
  value: string | number;
  unit: string;
  status: VitalStatus;
  trend: number[];
  accent: string;
};

// Placeholder data. Replace with your API or state later.
const VITALS: Vital[] = [
  {
    id: "heart-rate",
    label: "Heart Rate",
    value: 120,
    unit: "bpm",
    status: "High",
    trend: [62, 90, 80, 66, 88],
    accent: "#3B82F6",
  },
  {
    id: "body-temp",
    label: "Body Temp.",
    value: 36.2,
    unit: "°C",
    status: "Normal",
    trend: [36.6, 36.2, 36.2, 36.3, 36.5, 36.3, 36.2],
    accent: "#4F46E5",
  },
  {
    id: "blood-oxygen",
    label: "Blood Oxygen",
    value: 97,
    unit: "%",
    status: "Normal",
    trend: [96.5, 96.7, 96.4, 97, 97.1, 97, 96.6],
    accent: "#4F46E5",
  },
];

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "m1",
    from: "assistant",
    text: "I see a headache logged today. How long have you had it?",
  },
];

export default function DashboardPage() {
  const { checkups, activeCheckup, startCheckup, closeCheckup, completeCheckup } =
    useCheckups();
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);

  const handleSaveSymptom = (entry: SymptomEntry) => {
    // Send the entry to your backend here
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        from: "assistant",
        text: `I logged ${entry.symptom.toLowerCase()} at severity ${entry.severity}. How long have you had it?`,
      },
    ]);
  };

  const handleSend = (text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), from: "user", text },
    ]);
    // Call your assistant endpoint here and append its reply
  };

  return (
    <main className="pulsars">
      <div className="dashboard">
        <div className="dashboard__main">
          <div className="dashboard__vitals">
            {VITALS.map(({ id, ...vital }) => (
              <VitalCard key={id} {...vital} />
            ))}
          </div>

          <div className="dashboard__panels">
            <Checkups checkups={checkups} onStart={startCheckup} />
            <SymptomLog onSave={handleSaveSymptom} />
          </div>
        </div>

        <HealthAssistant messages={messages} onSend={handleSend} />
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