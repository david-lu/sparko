import { useEffect, useId, useState } from 'react';
import { LORA_STRENGTH, loraStrengthSchema } from '../../../shared/loras';

export default function LoraStrength({ value = LORA_STRENGTH.default, onChange, disabled = false }: {
  value?: number; onChange: (value: number) => void; disabled?: boolean;
}) {
  const id = useId(), [draft, setDraft] = useState(String(value));
  // Keep the usual 0–2 range precise, while retaining strengths entered numerically or loaded from a project.
  const [range, setRange] = useState({ min: Math.min(0, value), max: Math.max(2, value) });
  useEffect(() => setDraft(String(value)), [value]);
  useEffect(() => {
    setRange(current => value < current.min || value > current.max
      ? { min: Math.min(current.min, value), max: Math.max(current.max, value) } : current);
  }, [value]);
  return <div className="lora-strength">
    <label className="lora-strength-label" htmlFor={id}>Strength</label>
    <div className="lora-strength-controls">
      <input id={id} aria-label="LoRA strength" aria-describedby={`${id}-help`} type="range" disabled={disabled}
        min={Math.min(range.min, value)} max={Math.max(range.max, value)} step={LORA_STRENGTH.step} value={value}
        aria-valuetext={`${value} strength`} onChange={event => onChange(event.target.valueAsNumber)}/>
      <input aria-label="LoRA strength value" aria-describedby={`${id}-help`} type="number" required disabled={disabled}
        min={LORA_STRENGTH.min} max={LORA_STRENGTH.max} step={LORA_STRENGTH.step} value={draft}
        onChange={event => {
          setDraft(event.target.value);
          const parsed = loraStrengthSchema.safeParse(event.target.valueAsNumber);
          if (parsed.success && event.target.validity.valid) onChange(parsed.data);
        }} onBlur={() => setDraft(String(value))}/>
    </div>
    <p id={`${id}-help`} className="hint">0 = off · 1 = normal</p>
  </div>;
}
