import { useEffect, useState } from "react";
import { searchPatients } from "../../api/medic";
import type { PatientHit, RosterPatient } from "../../api/medic";
import { rosterStatus, sortRoster } from "../../lib/medic";
import TierBadge from "../metrics/TierBadge";

type PatientListProps = {
  patients: RosterPatient[];
  loading: boolean;
  error: string | null;
  selectedId: number | null;
  now: number;
  /** `following` is false for a patient found by search that has no check-up from this medic yet. */
  onSelect: (patient: { id: number; name: string }, following: boolean) => void;
};

type Hits = { term: string; list: PatientHit[]; failed: boolean };

export default function PatientList({ patients, loading, error, selectedId, now, onSelect }: PatientListProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hits | null>(null);
  const term = query.trim();

  // Patients the medic doesn't follow yet are found on the server, after a short pause in typing.
  useEffect(() => {
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchPatients(term, controller.signal)
        .then((list) => setHits({ term, list, failed: false }))
        .catch(() => {
          if (!controller.signal.aborted) setHits({ term, list: [], failed: true });
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  const mine = sortRoster(patients, now).filter((p) => p.name.toLowerCase().includes(term.toLowerCase()));
  const found = term.length >= 2 && hits?.term === term ? hits : null;
  const others = found ? found.list.filter((h) => !patients.some((p) => p.id === h.id)) : [];

  return (
    <section className="card medic-roster" aria-labelledby="roster-title">
      <h2 id="roster-title" className="card__title card__title--lg">
        Patients
      </h2>

      <label className="field">
        <span className="visually-hidden">Search patients</span>
        <input
          className="field__control"
          type="search"
          placeholder="Search patients"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {mine.length > 0 && (
        <ul className="roster__list">
          {mine.map((p) => {
            const { status, label, note, level } = rosterStatus(p, now);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={`roster__item${p.id === selectedId ? " roster__item--selected" : ""}`}
                  aria-current={p.id === selectedId ? "true" : undefined}
                  onClick={() => onSelect(p, true)}
                >
                  <span className="roster__name">{p.name}</span>
                  <span className="roster__status">
                    {level ? <TierBadge level={level} small /> : <span className={`chip chip--${status}`}>{label}</span>}
                    <span className="roster__note">{note}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {mine.length === 0 && !term && (
        <p className="roster__empty">
          {loading
            ? "Loading..."
            : "You aren't following anyone yet. Search by name, then assign a first check-up to start following a patient."}
        </p>
      )}
      {mine.length === 0 && term && others.length === 0 && (
        <p className="roster__empty">
          {term.length < 2 ? "Type at least 2 letters to search all patients." : found ? (found.failed ? "The search failed." : "No patient found.") : "Searching..."}
        </p>
      )}

      {others.length > 0 && (
        <>
          <h3 className="roster__heading">Other patients</h3>
          <ul className="roster__list">
            {others.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className={`roster__item${h.id === selectedId ? " roster__item--selected" : ""}`}
                  aria-current={h.id === selectedId ? "true" : undefined}
                  onClick={() => onSelect(h, false)}
                >
                  <span className="roster__name">{h.name}</span>
                  <span className="roster__status">
                    <span className="chip chip--quiet">Not following</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {mine.length > 0 && <p className="roster__foot">Sorted by status, alerts first.</p>}
    </section>
  );
}
