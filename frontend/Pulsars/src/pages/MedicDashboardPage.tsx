import { useMemo, useState } from "react";
import { acknowledgeAlert } from "../api/medic";
import type { Alert } from "../api/medic";
import AlertsPanel from "../components/medic/AlertsPanel";
import AssignCheckup from "../components/medic/AssignCheckup";
import CheckupHistory from "../components/medic/CheckupHistory";
import MessagesPlaceholder from "../components/medic/MessagesPlaceholder";
import PatientHeader from "../components/medic/PatientHeader";
import PatientList from "../components/medic/PatientList";
import SummaryPanel from "../components/medic/SummaryPanel";
import SymptomPanel from "../components/medic/SymptomPanel";
import TrendCard from "../components/medic/TrendCard";
import { useNow } from "../hooks/useNow";
import { usePatientDashboard } from "../hooks/usePatientDashboard";
import { useRoster } from "../hooks/useRoster";
import { SENSOR_METRIC } from "../lib/metrics";
import { rangeById, sortRoster, summaryBullets, trendsToCsv } from "../lib/medic";
import type { RangeId } from "../lib/medic";
import "../styles/Pulsars.css";
import "../styles/Medic.css";

type Chosen = { id: number; name: string };

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function MedicDashboardPage() {
  const now = useNow(10_000);
  const roster = useRoster();
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [range, setRange] = useState<RangeId>("7d");

  // Until one is picked, show the patient who needs attention first.
  const first = useMemo(() => sortRoster(roster.patients, now)[0], [roster.patients, now]);
  const current: Chosen | null = chosen ?? (first ? { id: first.id, name: first.name } : null);
  const entry = current ? roster.patients.find((p) => p.id === current.id) : undefined;
  // A patient found by search has no check-up from this medic yet, so there is nothing to read.
  const following = entry !== undefined;

  const dashboard = usePatientDashboard(following && current ? current.id : null, range);
  const { data } = dashboard;
  const rangeInfo = rangeById(range);

  const bullets = useMemo(
    () => (data ? summaryBullets({ range: rangeInfo, ...data, now: data.fetchedAt }) : []),
    [data, rangeInfo],
  );

  const lastReadingAt = !data
    ? undefined
    : (() => {
        const times = Object.values(data.latest).flatMap((l) => (l ? [Date.parse(l.recordedAt)] : []));
        return times.length > 0 ? Math.max(...times) : null;
      })();

  const handleAcknowledge = async (alert: Alert) => {
    if (!current) return;
    await acknowledgeAlert(current.id, alert);
    dashboard.reload();
    roster.reload();
  };

  const handleExport = () => {
    if (!data || !current) return;
    const slug = current.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "patient";
    download(`pulsars-${slug}-${range}.csv`, trendsToCsv(data.trends));
  };

  const handleAssigned = () => {
    roster.reload(); // a first check-up makes this a patient the medic follows
    dashboard.reload();
  };

  return (
    <main className="pulsars medic">
      <aside className="medic__left">
        <PatientList
          patients={roster.patients}
          loading={roster.loading}
          error={roster.error}
          selectedId={current?.id ?? null}
          now={now}
          onSelect={(patient) => setChosen({ id: patient.id, name: patient.name })}
        />
      </aside>

      <div className="medic__main">
        {!current && (
          <section className="card medic-empty">
            <h2 className="card__title card__title--lg">No patient selected</h2>
            <p>
              Search for a patient on the left. Assigning them a check-up lets you follow their vitals, alerts,
              symptoms and follow-up threads here.
            </p>
          </section>
        )}

        {current && (
          <>
            <PatientHeader
              name={current.name}
              age={entry?.age ?? null}
              lastReadingAt={lastReadingAt}
              now={now}
              range={range}
              onRange={setRange}
              onExport={handleExport}
              hasData={following}
              canExport={data !== null}
            />

            {!following && (
              <section className="card medic-empty">
                <h2 className="card__title card__title--lg">You aren't following {current.name} yet</h2>
                <p>
                  Assign a checkup to start following this patient. Their vitals, health alerts, symptom log and
                  follow-up threads will appear here once you do.
                </p>
              </section>
            )}

            {following && dashboard.error && (
              <p role="alert" className="notice">
                {data ? `Couldn't refresh: ${dashboard.error}` : dashboard.error}
              </p>
            )}

            {following && !data && !dashboard.error && <p className="medic-loading">Loading...</p>}

            {following && data && (
              <>
                <div className="medic__vitals">
                  {(["hr", "bt", "bo"] as const).map((type) => (
                    <TrendCard
                      key={type}
                      type={type}
                      trend={data.trends[type]}
                      latest={data.latest[type]}
                      rangePhrase={rangeInfo.phrase}
                      rangeAgo={rangeInfo.ago}
                      now={now}
                      status={data.health.metrics.find((m) => m.metricId === SENSOR_METRIC[type]) ?? null}
                    />
                  ))}
                </div>

                <AlertsPanel key={current.id} alerts={data.alerts} now={now} onAcknowledge={handleAcknowledge} />

                <SummaryPanel
                  title={`Last ${rangeInfo.phrase.replace("last ", "")}`}
                  bullets={bullets}
                  generatedAt={data.fetchedAt}
                />

                <div className="medic__pair">
                  <SymptomPanel symptoms={data.symptoms} now={now} />
                  <CheckupHistory checkups={data.checkups} now={now} />
                </div>
              </>
            )}
          </>
        )}
      </div>

      <aside className="medic__right">
        {current && (
          <>
            <MessagesPlaceholder name={current.name} />
            <AssignCheckup key={current.id} patient={current} onAssigned={handleAssigned} />
          </>
        )}
      </aside>
    </main>
  );
}
