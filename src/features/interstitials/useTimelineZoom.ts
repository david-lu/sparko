import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export function useTimelineZoom(track: RefObject<HTMLDivElement | null>, frame: number, frames: number, active: boolean) {
  const [zoom, setZoom] = useState(1);
  const latest = useRef({ zoom, frame, frames }); latest.current = { zoom, frame, frames };
  const anchor = useRef<{ fraction: number; offset: number } | undefined>(undefined);
  const change = (value: number, clientX?: number) => {
    const lane = track.current, scroller = lane?.parentElement;
    const next = Math.max(1, Math.min(16, Math.round(value * 100) / 100));
    if (!lane || !scroller || next === latest.current.zoom) return;
    const box = lane.getBoundingClientRect(), view = scroller.getBoundingClientRect();
    const cursor = box.left + latest.current.frame / latest.current.frames * box.width;
    const point = clientX ?? Math.max(view.left + 24, Math.min(view.right - 24, cursor));
    anchor.current = { fraction: (point - box.left) / box.width, offset: point - view.left };
    latest.current.zoom = next; setZoom(next);
  };
  useLayoutEffect(() => {
    const lane = track.current, scroller = lane?.parentElement, point = anchor.current; anchor.current = undefined;
    if (lane && scroller && point) scroller.scrollLeft += lane.getBoundingClientRect().left + point.fraction * lane.getBoundingClientRect().width - scroller.getBoundingClientRect().left - point.offset;
  }, [zoom]);
  useEffect(() => {
    const scroller = track.current?.parentElement;
    if (!scroller) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      change(latest.current.zoom * Math.exp(-event.deltaY * (event.deltaMode === 1 ? .12 : .01)), event.clientX);
    };
    scroller.addEventListener('wheel', wheel, { passive: false });
    return () => scroller.removeEventListener('wheel', wheel);
  }, [track, active]);
  return { zoom, change };
}
