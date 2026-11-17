import { useState } from "react";
import { errorMessage } from "../api/client";
import { setEnvironmentProfile } from "../api/metrics";
import type { LogKind, MetricId } from "../api/metrics";
import PageHeader from "../components/PageHeader";
import BpForm from "../components/metrics/BpForm";
import LogHistory from "../components/metrics/LogHistory";
import MetricTile from "../components/metrics/MetricTile";
import OrthostaticForm from "../components/metrics/OrthostaticForm";
import SleepForm from "../components/metrics/SleepForm";
import { CoreTempForm, ExerciseForm } from "../components/metrics/SimpleLogForms";
import { useMetricStatus } from "../hooks/useMetricStatus";
import { useMetricsConfig } from "../hooks/useMetricsConfig";
import { useSession } from "../hooks/useSession";
import { LOG_KIND_LABEL } from "../lib/logs";
import "../styles/Pulsars.css";
import "../styles/Medic.css";
import "../styles/Metrics.css";

const BASE_KINDS: LogKind[] = ["bp", "sleep", "core_temp", "exercise"];

export default function HealthLogPage() {
  const session = useSession();
  const { config, error: configError } = useMetricsConfig();
  const health = useMetricStatus();
  const [selected, setSelected] = useState<LogKind>("bp");
  const [version, setVersion] = useState(0);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const status = health.status;
  const gravity = status?.profile.gravity ?? false;
  const kinds: LogKind[] = gravity ? [...BASE_KINDS, "orthostatic"] : BASE_KINDS;
  const kind = kinds.includes(selected) ? selected : "bp";
  const logSymptoms = config?.log_symptoms ?? [];
  const tileFor = (id: MetricId) => status?.metrics.find((m) => m.metricId === id) ?? null;
  const configFor = (id: MetricId) => config?.metrics.find((m) => m.metric_id === id);

  // A saved entry changes the tiers and the list at once, instead of waiting for the next poll
  const saved = () => {
    setVersion((v) => v + 1);
    health.reload();
  };

  const changeProfile = async (id: string) => {
    if (!session) return;
    setSavingProfile(true);
    setProfileError(null);
    try {
      await setEnvironmentProfile(session.user.id, id);
      health.reload();
    } catch (err) {
      setProfileError(errorMessage(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const currentProfile = config?.profiles.find((p) => p.id === status?.profile.id);
  const problem = configError ?? health.error;

  return (
    <main className="pulsars">
      <PageHeader
        title="Health log"
        subtitle="Measurements you take yourself. They feed the same tiers as the band."
      />

      {problem && (
        <p role="alert" className="notice">
          {problem}
        </p>
      )}

      <div className="healthlog__tiles">
        <MetricTile config={configFor("bp")} status={tileFor("bp")} title="Blood pressure" detailsTo="/metrics/bp" />
        <MetricTile config={configFor("sleep")} status={tileFor("sleep")} title="Sleep" detailsTo="/metrics/sleep" />
        {gravity && (
          <MetricTile
            config={configFor("orthostatic")}
            status={tileFor("orthostatic")}
            title="Standing test"
            detailsTo="/metrics/orthostatic"
          />
        )}

        <section className="card profile-card" aria-labelledby="profile-title">
          <h2 id="profile-title" className="card__title">
            Where you are
          </h2>
          <label className="field">
            <span className="visually-hidden">Environment</span>
            <select
              className="field__control field__control--select"
              value={status?.profile.id ?? ""}
              disabled={!config || !status || savingProfile}
              onChange={(e) => void changeProfile(e.target.value)}
            >
              {!status && <option value="">Loading...</option>}
              {config?.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <p className="tier-note__reason">
            {currentProfile?.note}{" "}
            {gravity ? "The standing test is on." : "No gravity here, so the standing test is off."}
          </p>
          {profileError && (
            <p role="alert" className="form-error">
              {profileError}
            </p>
          )}
        </section>
      </div>

      <div className="split split--equal">
        <section className="card log-card" aria-labelledby="log-title">
          <h2 id="log-title" className="card__title card__title--lg">
            Log a measurement
          </h2>
          <div className="segmented healthlog__kinds" role="group" aria-label="What to log">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                className={`segmented__btn${k === kind ? " segmented__btn--on" : ""}`}
                aria-pressed={k === kind}
                onClick={() => setSelected(k)}
              >
                {LOG_KIND_LABEL[k]}
              </button>
            ))}
          </div>

          {kind === "bp" && <BpForm symptoms={logSymptoms} onSaved={saved} />}
          {kind === "sleep" && <SleepForm onSaved={saved} />}
          {kind === "core_temp" && <CoreTempForm onSaved={saved} />}
          {kind === "exercise" && <ExerciseForm onSaved={saved} />}
          {kind === "orthostatic" && <OrthostaticForm symptoms={logSymptoms} onSaved={saved} />}
        </section>

        <LogHistory kind={kind} symptoms={logSymptoms} version={version} />
      </div>

      {config && <p className="proposed-note">{config.disclaimer}</p>}
    </main>
  );
}
