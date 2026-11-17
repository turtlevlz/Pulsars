import VitalCard from "../components/VitalCard";
import Checkups from "../components/Checkups";
import CheckupModal from "../components/CheckupModal";
import SymptomLog from "../components/SymptomLog";
import type { SymptomEntry } from "../components/SymptomLog";
import RecentSymptoms from "../components/RecentSymptoms";
import HealthAssistant from "../components/HealthAssistant";
import AlertStrip from "../components/metrics/AlertStrip";
import { useAssistant } from "../hooks/useAssistant";
import { useCheckups } from "../hooks/useCheckups";
import { useMetricStatus } from "../hooks/useMetricStatus";
import { useMetricsConfig } from "../hooks/useMetricsConfig";
import { useRecentSymptoms } from "../hooks/useRecentSymptoms";
import { useVitals } from "../hooks/useVitals";
import { createSymptom } from "../api/symptoms";
import { VITAL_DEFINITIONS } from "../lib/vitals";
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
  const health = useMetricStatus();
  const { config } = useMetricsConfig();
  const recentSymptoms = useRecentSymptoms();

  const vitalCards = VITAL_DEFINITIONS.map(({ id, type, metricId, decimals, ...definition }) => {
    const readings = vitals.series[type] ?? [];
    const latest = readings.at(-1);

    return {
      id,
      label: definition.label,
      unit: definition.unit,
      accent: definition.accent,
      value: latest ? latest.value.toFixed(decimals) : "--",
      updatedAt: latest ? Date.parse(latest.recordedAt) : null,
      loading: vitals.loading,
      trend: readings.map((r) => r.value),
      trendTimes: readings.map((r) => Date.parse(r.recordedAt)),
      // null while the tiers load, so the card shows "Checking..." instead of a wrong colour
      status: health.status?.metrics.find((m) => m.metricId === metricId) ?? null,
      detailsTo: `/metrics/${metricId}`,
    };
  });

  // Saving a symptom opens a follow-up thread on the server; the assistant picks it up
  const handleSaveSymptom = async (entry: SymptomEntry) => {
    const created = await createSymptom(entry);
    recentSymptoms.add(created);
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

  const problem = vitals.error ?? checkupsError ?? health.error;

  return (
    <main className="pulsars">
      {problem && (
        <p role="alert" className="notice">
          {problem}
        </p>
      )}

      <div className="dashboard">
        <div className="dashboard__main">
          {health.status && <AlertStrip alerts={health.status.alerts} />}

          <div className="dashboard__vitals">
            {vitalCards.map(({ id, ...vital }) => (
              <VitalCard key={id} {...vital} />
            ))}
          </div>

          <div className="dashboard__panels">
            <Checkups
              variant="overview"
              viewAllTo="/checkups"
              checkups={checkups}
              onStart={startCheckup}
              emptyMessage={
                checkupsLoading
                  ? "Loading checkups..."
                  : "No checkups assigned to you yet."
              }
            />
            <SymptomLog
              onSave={handleSaveSymptom}
              picklist={config?.symptoms}
              escalateTo={config?.escalate_to}
              footer={
                <RecentSymptoms
                  records={recentSymptoms.records}
                  loading={recentSymptoms.loading}
                />
              }
            />
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
