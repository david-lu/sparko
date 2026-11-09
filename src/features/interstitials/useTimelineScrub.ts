import { useRef, useState, type PointerEvent, type RefObject } from 'react';

/** One coordinate system for the ruler, footage and empty tracks, including at zoom. */
export function useTimelineScrub({ track, frames, frame, onSeek }: {
  track: RefObject<HTMLDivElement | null>; frames: number; frame: number; onSeek: (frame: number) => void;
}) {
  const gesture = useRef<{ element: HTMLElement; pointer: number; frame: number } | undefined>(undefined);
  const [active, setActive] = useState(false);
  const seek = (event: PointerEvent<HTMLElement>) => {
    const box = track.current?.getBoundingClientRect();
    if (box?.width) onSeek(Math.max(0, Math.min(frames - 1, Math.round((event.clientX - box.left) / box.width * frames))));
  };
  const finish = (cancel = false) => {
    const current = gesture.current; gesture.current = undefined; setActive(false);
    if (!current) return;
    if (cancel) onSeek(current.frame);
    if (current.element.hasPointerCapture(current.pointer)) current.element.releasePointerCapture(current.pointer);
  };
  const handlers = (prepare?: () => void, backgroundOnly = false) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || backgroundOnly && event.target !== event.currentTarget) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { element: event.currentTarget, pointer: event.pointerId, frame }; setActive(true);
      prepare?.(); seek(event);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => { if (gesture.current?.element === event.currentTarget) seek(event); },
    onPointerUp: (event: PointerEvent<HTMLElement>) => { if (gesture.current?.element === event.currentTarget) { seek(event); finish(); } },
    onPointerCancel: () => finish(true),
    onLostPointerCapture: () => finish(),
  });
  return { active, handlers, cancel: () => finish(true) };
}
