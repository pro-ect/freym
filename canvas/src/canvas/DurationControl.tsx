import { useEffect, useState } from "react";

/**
 * Duration as a slider over the provider's allowed values, plus a number box
 * for keyboard entry. Typed values snap to the nearest allowed option on
 * Enter/blur, so the node never sends a duration the API (or billing) would
 * reject.
 */
export default function DurationControl({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: number[];
  value: number;
  onChange: (n: number) => void;
}) {
  const sorted = [...options].sort((a, b) => a - b);
  const current = sorted.includes(value) ? value : sorted[0];
  const idx = sorted.indexOf(current);
  const [typed, setTyped] = useState(String(current));

  useEffect(() => setTyped(String(current)), [current]);

  const snap = (n: number) =>
    sorted.reduce((best, o) => (Math.abs(o - n) < Math.abs(best - n) ? o : best), sorted[0]);

  const commit = () => {
    const n = Number(typed);
    if (Number.isFinite(n) && typed.trim() !== "") onChange(snap(n));
    else setTyped(String(current));
  };

  return (
    <label className="fc-field">
      <span>
        {label} <em className="fc-field-val">{current} s</em>
      </span>
      <div className="fc-duration">
        <input
          type="range"
          min={0}
          max={sorted.length - 1}
          step={1}
          value={idx}
          onChange={(e) => onChange(sorted[Number(e.target.value)])}
        />
        <input
          className="fc-text-input fc-duration-num"
          type="number"
          min={sorted[0]}
          max={sorted[sorted.length - 1]}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
    </label>
  );
}
