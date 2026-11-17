import type { LogSymptom } from "../../api/metrics";

type SymptomChecksProps = {
  legend: string;
  options: LogSymptom[];
  selected: string[];
  onChange: (selected: string[]) => void;
};

/** "Do you feel any of these right now?": the symptoms the checks care about, from the config. */
export default function SymptomChecks({ legend, options, selected, onChange }: SymptomChecksProps) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  return (
    <fieldset className="field">
      <legend className="field__label">{legend}</legend>
      <div className="check-grid">
        {options.map((o) => (
          <label key={o.id} className="check">
            <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
