import { Check } from 'lucide-react';
import { clipColors, clipColorName, type ClipColor } from './clipColors';

export default function ClipColorPicker({ color, onChange }: { color?: ClipColor; onChange: (color: ClipColor) => void }) {
  return <div className="inspector-property"><span>Color</span><div className="clip-colors" role="group" aria-label="Clip color">
    {(Object.keys(clipColors) as ClipColor[]).map(value => <button key={value} type="button" aria-label={`${clipColorName(value)} clip color`}
      title={clipColorName(value)} aria-pressed={color === value} style={{ background: clipColors[value] }} onClick={() => onChange(value)}>
      {color === value && <Check size={12} aria-hidden />}
    </button>)}
  </div></div>;
}
