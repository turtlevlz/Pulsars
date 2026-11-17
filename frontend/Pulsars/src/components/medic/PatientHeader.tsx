import { RANGES, formatAgo, initials } from "../../lib/medic";
import type { RangeId } from "../../lib/medic";

type PatientHeaderProps = {
  name: string;
  age: number | null;
  /** When the newest reading was taken (ms), null if none, undefined while loading. */
  lastReadingAt: number | null | undefined;
  now: number;
  range: RangeId;
  onRange: (range: RangeId) => void;
  onExport: () => void;
  /** False for a patient the medic doesn't follow yet: there is no data to range over or export. */
  hasData: boolean;
  canExport: boolean;
};

export default function PatientHeader({
  name,
  age,
  lastReadingAt,
  now,
  range,
  onRange,
  onExport,
  hasData,
  canExport,
}: PatientHeaderProps) {
  const parts: string[] = [];
  if (age !== null) parts.push(`Age ${age}`);
  if (hasData) {
    if (lastReadingAt === undefined) parts.push("Loading...");
    else if (lastReadingAt === null) parts.push("No readings yet");
    else parts.push(`Last data received ${formatAgo(Math.max(0, now - lastReadingAt))}`);
  }

  return (
    <section className="card medic-header" aria-label="Selected patient">
      <span className="avatar" aria-hidden="true">
        {initials(name)}
      </span>
      <div className="medic-header__who">
        <h2 className="medic-header__name">{name}</h2>
        {parts.length > 0 && <p className="medic-header__meta">{parts.join(" | ")}</p>}
      </div>

      {hasData && (
        <div className="medic-header__controls">
          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`segmented__btn${r.id === range ? " segmented__btn--on" : ""}`}
                aria-pressed={r.id === range}
                onClick={() => onRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button type="button" className="segmented__btn segmented__btn--solo" disabled={!canExport} onClick={onExport}>
            Export
          </button>
        </div>
      )}
    </section>
  );
}
