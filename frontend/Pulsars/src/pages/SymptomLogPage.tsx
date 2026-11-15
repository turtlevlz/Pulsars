import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import SymptomLog from "../components/SymptomLog";
import type { SymptomEntry } from "../components/SymptomLog";
import SymptomHistory from "../components/SymptomHistory";
import type { SymptomRecord } from "../components/SymptomHistory";
import { errorMessage } from "../api/client";
import { createSymptom, listSymptoms, symptomToRecord } from "../api/symptoms";
import "../styles/Pulsars.css";

export default function SymptomLogPage() {
  const [records, setRecords] = useState<SymptomRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listSymptoms(controller.signal)
      .then((rows) => setRecords(rows.map(symptomToRecord)))
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  // Throws on failure, so the form shows the message and keeps what was typed
  const handleSave = async (entry: SymptomEntry) => {
    const created = await createSymptom(entry);
    setRecords((prev) => [symptomToRecord(created), ...prev]);
  };

  return (
    <main className="pulsars">
      <PageHeader
        title="Symptom log"
        subtitle="Track how you feel and review your past entries."
      />

      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}

      <div className="split">
        <SymptomLog onSave={handleSave} />
        <SymptomHistory
          records={records}
          emptyMessage={loading ? "Loading..." : "No symptoms logged yet."}
        />
      </div>
    </main>
  );
}
