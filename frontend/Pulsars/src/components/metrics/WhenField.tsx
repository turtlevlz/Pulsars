type WhenFieldProps = {
  value: string;
  onChange: (value: string) => void;
};

/** "When was it?": blank means now. The browser stops a time in the future. */
export default function WhenField({ value, onChange }: WhenFieldProps) {
  return (
    <label className="field">
      <span className="field__label">When was it? (leave blank for now)</span>
      <input
        className="field__control"
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
