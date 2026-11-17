import { useState } from "react";
import { createLog } from "../../api/metrics";
import type { LogSymptom, Posture } from "../../api/metrics";
import { meanArterialPressure, whenOrNow, wholeNumber } from "../../lib/logs";
import LogFormShell from "./LogFormShell";
import SymptomChecks from "./SymptomChecks";
import WhenField from "./WhenField";

type BpFormProps = {
  symptoms: LogSymptom[];
  onSaved: () => void;
};

const POSTURES: { value: Posture; label: string }[] = [
  { value: "seated", label: "Seated" },
  { value: "supine", label: "Lying down" },
  { value: "standing", label: "Standing" },
];

export default function BpForm({ symptoms, onSaved }: BpFormProps) {
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [posture, setPosture] = useState<Posture>("seated");
  const [rested, setRested] = useState(false);
  const [armLevel, setArmLevel] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const [when, setWhen] = useState("");

  const sys = wholeNumber(systolic);
  const dia = wholeNumber(diastolic);
  const map = sys !== null && dia !== null && sys > dia ? meanArterialPressure(sys, dia) : null;

  const save = async () => {
    const heartRate = wholeNumber(pulse);
    if (sys === null || dia === null || heartRate === null) {
      throw new Error("Enter the top and bottom pressure and your pulse as whole numbers.");
    }
    await createLog(
      "bp",
      {
        systolic: sys,
        diastolic: dia,
        heartRate,
        posture,
        restedFiveMinutes: rested,
        armAtHeartLevel: armLevel,
        symptoms: ticked,
      },
      whenOrNow(when),
    );
    setSystolic("");
    setDiastolic("");
    setPulse("");
    setTicked([]);
    setWhen("");
    onSaved();
  };

  return (
    <LogFormShell submitLabel="Save blood pressure" onSubmit={save}>
      <div className="log-form__row">
        <label className="field">
          <span className="field__label">Top (systolic)</span>
          <input
            className="field__control"
            inputMode="numeric"
            placeholder="mmHg"
            value={systolic}
            onChange={(e) => setSystolic(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Bottom (diastolic)</span>
          <input
            className="field__control"
            inputMode="numeric"
            placeholder="mmHg"
            value={diastolic}
            onChange={(e) => setDiastolic(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Pulse</span>
          <input
            className="field__control"
            inputMode="numeric"
            placeholder="bpm"
            value={pulse}
            onChange={(e) => setPulse(e.target.value)}
          />
        </label>
      </div>
      <p className="log-form__hint">{map !== null ? `Mean arterial pressure: ${map} mmHg` : " "}</p>

      <label className="field">
        <span className="field__label">Position</span>
        <select
          className="field__control field__control--select"
          value={posture}
          onChange={(e) => setPosture(e.target.value as Posture)}
        >
          {POSTURES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <div className="check-grid">
        <label className="check">
          <input type="checkbox" checked={rested} onChange={(e) => setRested(e.target.checked)} />
          <span>I rested for 5 minutes first</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={armLevel} onChange={(e) => setArmLevel(e.target.checked)} />
          <span>My arm was at heart level</span>
        </label>
      </div>

      <SymptomChecks
        legend="Do you feel any of these right now?"
        options={symptoms}
        selected={ticked}
        onChange={setTicked}
      />
      <WhenField value={when} onChange={setWhen} />
    </LogFormShell>
  );
}
