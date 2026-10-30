import { useEffect, useRef } from 'react';
import { useWorkspaceLocked } from './panels/WorkspaceLock';

export default function ResizeHandle({ orientation, value, min, max, onChange, label }: {
  orientation: 'horizontal' | 'vertical'; value: number; min: number; max: number;
  onChange: (value: number) => void; label: string;
}) {
  const locked=useWorkspaceLocked(),element=useRef<HTMLDivElement>(null);
  const drag = useRef<{ coordinate: number; value: number;pointerId:number } | null>(null);
  useEffect(()=>{if(!locked)return;const active=drag.current;drag.current=null;
    if(active){document.body.style.cursor='';if(element.current?.hasPointerCapture(active.pointerId))element.current.releasePointerCapture(active.pointerId);}
  },[locked]);
  const resize = (next: number) => onChange(Math.round(Math.max(min, Math.min(max, next))));
  return <div ref={element} className={`resize-handle ${orientation}`} role="separator" tabIndex={locked?-1:0} aria-disabled={locked||undefined} title={locked?'Unlock workspace in Window to resize panels':undefined}
    aria-label={label} aria-orientation={orientation} aria-valuenow={Math.round(value)} aria-valuemin={min} aria-valuemax={Math.round(max)}
    onPointerDown={event => {
      if (locked||event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { coordinate: orientation === 'vertical' ? event.clientX : event.clientY, value,pointerId:event.pointerId };
      document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';
    }} onPointerMove={event => {
      if (locked||!drag.current) return;
      resize(drag.current.value + drag.current.coordinate - (orientation === 'vertical' ? event.clientX : event.clientY));
    }} onLostPointerCapture={() => { drag.current = null; document.body.style.cursor = ''; }}
    onPointerUp={event => { drag.current = null; document.body.style.cursor = ''; if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId); }}
    onKeyDown={event => {
      if(locked)return;
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
