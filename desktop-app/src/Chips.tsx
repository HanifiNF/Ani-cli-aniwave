export default function Chips<T extends string>({ label, value, options, onChange, names }: { label?: string; value: T; options: readonly T[]; onChange: (value: T) => void; names?: Partial<Record<T, string>> }) {
  return (
    <span className="chips-row">
      {label && <span className="chips-lab">{label}</span>}
      <span className="chips" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button type="button" key={option} role="radio" aria-checked={option === value} className={option === value ? "on" : ""} onClick={() => onChange(option)}>{names?.[option] ?? option}</button>
        ))}
      </span>
    </span>
  );
}

