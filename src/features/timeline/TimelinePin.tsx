import { useEffect, useRef, useState, type RefObject } from 'react';
import { X } from 'lucide-react';
import { formatTime } from '../../../shared/contracts';
import type { Pin } from './pins';

export default function TimelinePin({ pin, number, duration, fps, track, viewport, onMove, onRemove, onSeek }: {
  pin: Pin; number: number; duration: number; fps: number;
  track: RefObject<HTMLDivElement | null>; viewport: RefObject<HTMLDivElement | null>;
  onMove: (id: string, time: number) => void; onRemove: (id: string) => void; onSeek: (time: number) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; clientX: number; grabOffset: number; time: number; moved: boolean } | null>(null);
  const animation = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const [draftTime, setDraftTime] = useState<number | null>(null);
  const clamp = (value: number) => Math.max(0, Math.min(duration, Math.round(value * 1000) / 1000));
  const displayTime = draftTime ?? pin.time;
  const clearAnimation = () => { if (animation.current !== null) cancelAnimationFrame(animation.current); animation.current = null; };
  useEffect(() => clearAnimation, []);

  const updateDrag = () => {
    const current = drag.current; const rect = track.current?.getBoundingClientRect();
    if (!current || !rect?.width) return;
    current.time = clamp((current.clientX - rect.left - current.grabOffset) / rect.width * duration);
    setDraftTime(current.time);
  };
  const autoScroll = () => {
    const current = drag.current; const scroll = viewport.current;
    if (!current?.moved || !scroll) { animation.current = null; return; }
    const rect = scroll.getBoundingClientRect();
    const distance = current.clientX < rect.left + 32 ? current.clientX - rect.left - 32
      : current.clientX > rect.right - 32 ? current.clientX - rect.right + 32 : 0;
    const previous = scroll.scrollLeft;
    scroll.scrollLeft += Math.max(-14, Math.min(14, distance / 3));
    if (scroll.scrollLeft !== previous) updateDrag();
    animation.current = requestAnimationFrame(autoScroll);
  };
  const finish = (commit: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null; clearAnimation(); setDraftTime(null);
    suppressClick.current = current.moved || !commit;
    if (button.current?.hasPointerCapture(current.pointerId)) button.current.releasePointerCapture(current.pointerId);
    if (commit && current.moved && current.time !== pin.time) onMove(pin.id, current.time);
  };

  return <div className={`timeline-marker ${draftTime !== null ? 'dragging' : ''}`} style={{ left: `clamp(12px, ${displayTime / duration * 100}%, calc(100% - 12px))` }}>
    <button ref={button} className="timeline-pin" aria-label={`Go to ${pin.label} at ${formatTime(displayTime)}`} aria-describedby="pin-help"
      title={`${pin.label} · ${formatTime(displayTime, true)} · Drag to move · Delete to remove`} draggable={false}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        const rect = track.current?.getBoundingClientRect();
        if (!rect?.width) return;
        event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
        suppressClick.current = false;
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, clientX: event.clientX,
          grabOffset: event.clientX - rect.left - pin.time / duration * rect.width, time: pin.time, moved: false };
      }} onPointerMove={event => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        current.clientX = event.clientX;
        if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 4) return;
        current.moved = true; updateDrag();
        if (animation.current === null) animation.current = requestAnimationFrame(autoScroll);
      }} onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) finish(true); }}
      onPointerCancel={() => finish(false)} onLostPointerCapture={() => finish(false)}
      onClick={event => { if (!suppressClick.current || event.detail === 0) onSeek(pin.time); suppressClick.current = false; }}
      onKeyDown={event => {
        if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); finish(false); return; }
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); finish(false); onRemove(pin.id); return; }
        if (drag.current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const step = event.shiftKey ? 1 : 1 / fps;
        onMove(pin.id, event.key === 'Home' ? 0 : event.key === 'End' ? duration : clamp(pin.time + (event.key === 'ArrowLeft' ? -step : step)));
      }}>{number}</button>
    <button className="timeline-pin-remove" aria-label={`Delete ${pin.label}`} title={`Delete ${pin.label}`}
      onPointerUp={event => { if (event.pointerType === 'touch') { event.preventDefault(); onRemove(pin.id); } }}
      onClick={() => onRemove(pin.id)}><X size={12} /></button>
    {draftTime !== null && <output className="pin-drag-time">{formatTime(draftTime, true)}</output>}
  </div>;
}
