import { useRef } from 'react';

export default function ResizeHandle({ orientation, value, min, max, onChange, label }: {
  orientation: 'horizontal' | 'vertical'; value: number; min: number; max: number;
  onChange: (value: number) => void; label: string;
}) {
  const drag = useRef<{ coordinate: number; value: number } | null>(null);
  const resize = (next: number) => onChange(Math.round(Math.max(min, Math.min(max, next))));
  return <div className={`resize-handle ${orientation}`} role="separator" tabIndex={0}
    aria-label={label} aria-orientation={orientation} aria-valuenow={Math.round(value)} aria-valuemin={min} aria-valuemax={Math.round(max)}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { coordinate: orientation === 'vertical' ? event.clientX : event.clientY, value };
      document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';
    }} onPointerMove={event => {
      if (!drag.current) return;
      resize(drag.current.value + drag.current.coordinate - (orientation === 'vertical' ? event.clientX : event.clientY));
    }} onLostPointerCapture={() => { drag.current = null; document.body.style.cursor = ''; }}
    onPointerUp={event => { drag.current = null; document.body.style.cursor = ''; event.currentTarget.releasePointerCapture(event.pointerId); }}
    onKeyDown={event => {
      const increase = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
      const decrease = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
      const step = event.shiftKey ? 40 : 10;
      if ([increase, decrease, 'Home', 'End'].includes(event.key)) event.preventDefault();
      if (event.key === increase) resize(value + step);
      else if (event.key === decrease) resize(value - step);
      else if (event.key === 'Home') resize(min);
      else if (event.key === 'End') resize(max);
    }}><span /></div>;
}
