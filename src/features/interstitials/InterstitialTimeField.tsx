import { useEffect, useId, useRef, useState } from 'react';

export default function InterstitialTimeField({ name, label, value, min, max, step, onChange }: {
  name: string; label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void;
}) {
  const id = useId();
  const field = useRef<HTMLDivElement>(null);
  const number = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!field.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  return <div className="interstitial-time-field" ref={field}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      number.current?.focus(); setOpen(false);
    }}>
    <label className="interstitial-time-label" htmlFor={id}>{label}</label>
    <div className="interstitial-time-value">
      <input ref={number} id={id} aria-label={name} aria-controls={open ? `${id}-slider` : undefined} type="number" min={min} max={max} step="any" required
        value={Number.isFinite(value) ? value : ''} onChange={event => onChange(event.target.valueAsNumber)}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} />
      <span aria-hidden="true">s</span>
    </div>
    {open && <div className="interstitial-time-popover" id={`${id}-slider`} role="group" aria-label={`${label} adjustment`}>
      <input aria-label={`${label} slider`} type="range" min={min} max={max} step="any"
        value={Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min}
        onChange={event => onChange(Number(event.target.valueAsNumber.toFixed(3)))}
        onKeyDown={event => {
          const direction = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 0;
          if (!direction) return;
          event.preventDefault();
          onChange(Math.max(min, Math.min(max, Number(((Number.isFinite(value) ? value : min) + direction * step).toFixed(3)))));
        }} />
    </div>}
  </div>;
}
