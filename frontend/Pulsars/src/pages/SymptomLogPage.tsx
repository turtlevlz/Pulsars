import { useState } from "react";
import PageHeader from "../components/PageHeader";
import SymptomLog from "../components/SymptomLog";
import type { SymptomEntry } from "../components/SymptomLog";
import SymptomHistory from "../components/SymptomHistory";
import type { SymptomRecord } from "../components/SymptomHistory";
import "../styles/Pulsars.css";

// Placeholder history. Replace with your API or state later.
const INITIAL_RECORDS: SymptomRecord[] = [
  {
    id: "r1",
    symptom: "Fatigue",
    severity: 3,
    notes: "Felt tired after lunch.",
    loggedAt: "2026-11-13T20:40:00",
  },
  {
    id: "r2",
    symptom: "Dizziness",
    severity: 2,
    notes: "",
    loggedAt: "2026-11-12T08:15:00",
  },
  {
    id: "r3",
    symptom: "Headache",
    severity: 4,
    notes: "Started in the afternoon and lasted a few hours.",
    loggedAt: "2026-11-10T17:05:00",
  },
];

export default function SymptomLogPage() {
  const [records, setRecords] = useState<SymptomRecord[]>(INITIAL_RECORDS);

  const handleSave = (entry: SymptomEntry) => {
    // Send the entry to your backend here
    setRecords((prev) => [
      {
        id: crypto.randomUUID(),
        ...entry,
        loggedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  return (
    <main className="pulsars">
      <PageHeader
        title="Symptom log"
        subtitle="Track how you feel and review your past entries."
      />

      <div className="split">
        <SymptomLog onSave={handleSave} />
        <SymptomHistory records={records} />
      </div>
    </main>
  );
}