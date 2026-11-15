import VitalCard from "../components/VitalCard";
import type { VitalStatus } from "../components/VitalCard";
import Checkups from "../components/Checkups";
import CheckupModal from "../components/CheckupModal";
import SymptomLog from "../components/SymptomLog";
import type { SymptomEntry } from "../components/SymptomLog";
import HealthAssistant from "../components/HealthAssistant";
import { useAssistant } from "../hooks/useAssistant";
import { useCheckups } from "../hooks/useCheckups";
import { useVitals } from "../hooks/useVitals";
import { createSymptom } from "../api/symptoms";
import { VITAL_DEFINITIONS, vitalStatus } from "../lib/vitals";
import "../styles/Pulsars.css";

export default function DashboardPage() {
  const {
    checkups,
    loading: checkupsLoading,
    error: checkupsError,
    activeCheckup,
    startCheckup,
    closeCheckup,
    completeCheckup,
  } = useCheckups();
  const vitals = useVitals();
  const assistant = useAssistant();

  const vitalCards = VITAL_DEFINITIONS.map(({ id, type, decimals, normal, ...definition }) => {
    const readings = vitals.series[type] ?? [];
    const latest = readings.at(-1);

    const status: VitalStatus = latest
      ? vitalStatus(latest.value, normal)
      : vitals.loading
        ? "Loading"
        : "No data";

    return {
      id,
      label: definition.label,
      unit: definition.unit,
      accent: definition.accent,
      value: latest ? latest.value.toFixed(decimals) : "--",
      status,
      trend: readings.map((r) => r.value),
      trendTimes: readings.map((r) => Date.parse(r.recordedAt)),
    };
  });

  // Saving a symptom opens a follow-up thread on the server; the assistant picks it up
  const handleSaveSymptom = async (entry: SymptomEntry) => {
    const created = await createSymptom(entry);
    assistant.follow(created.threadId);
  };

  const canAnswer =
    assistant.threadId !== null && !assistant.closed && !assistant.busy;
  const placeholder =
    assistant.threadId === null
      ? "Log a symptom to start"
      : assistant.closed
        ? "This follow-up is finished"
        : assistant.busy
          ? "Waiting for the assistant..."
          : "Type your answer...";

  const problem = vitals.error ?? checkupsError;

  return (
    <main className="pulsars">
      {problem && (
        <p role="alert" className="notice">
          {problem}
        </p>
      )}

      <div className="dashboard">
        <div className="dashboard__main">
          <div className="dashboard__vitals">
            {vitalCards.map(({ id, ...vital }) => (
              <VitalCard key={id} {...vital} />
            ))}
          </div>

          <div className="dashboard__panels">
            <Checkups
              checkups={checkups}
              onStart={startCheckup}
              emptyMessage={
                checkupsLoading
                  ? "Loading checkups..."
                  : "No checkups assigned to you yet."
              }
            />
            <SymptomLog onSave={handleSaveSymptom} />
          </div>
        </div>

        <HealthAssistant
          messages={assistant.messages}
          onSend={(text) => void assistant.send(text)}
          busy={assistant.busy}
          disabled={!canAnswer}
          placeholder={placeholder}
          emptyText="Log a symptom and I'll ask a few follow-up questions."
          error={assistant.error}
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
