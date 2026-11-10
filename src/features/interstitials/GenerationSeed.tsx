import { useEffect, useId, useState } from 'react';
import { chooseGenerationSeed, generationSeedSchema, MAX_GENERATION_SEED } from '../../../shared/generation-seed';

export default function GenerationSeed({ value, lastSeed, onChange }: {
  value?: number; lastSeed?: number; onChange: (seed: number | undefined) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => { setText(value === undefined ? '' : String(value)); }, [value]);
  return <div className="field generation-seed">
    <label htmlFor={`${id}-mode`}>Seed</label>
    <div className="generation-seed-controls">
      <select id={`${id}-mode`} aria-label="Generation seed mode" value={value === undefined ? 'random' : 'fixed'}
        onChange={event => onChange(event.target.value === 'random' ? undefined : chooseGenerationSeed(lastSeed))}>
        <option value="random">Random</option><option value="fixed">Fixed</option>
      </select>
      <button type="button" className="button" disabled={lastSeed === undefined} onClick={() => {
        if (lastSeed !== undefined) { setText(String(lastSeed)); onChange(lastSeed); }
      }}>Use last seed</button>
    </div>
    <input type="number" aria-label="Generation seed value" aria-describedby={`${id}-help`} min={0} max={MAX_GENERATION_SEED} step={1}
      required={value !== undefined} disabled={value === undefined} placeholder="Automatic" value={text} onChange={event => {
        setText(event.target.value);
        const parsed = generationSeedSchema.safeParse(event.target.valueAsNumber);
        if (event.target.validity.valid && parsed.success) onChange(parsed.data);
      }} />
    <p id={`${id}-help`} className="hint">Random changes the seed; Fixed reuses it. Upscale to 2K has no seed control.</p>
  </div>;
}
