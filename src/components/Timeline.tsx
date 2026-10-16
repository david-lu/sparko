import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Minus, Pin as PinIcon, Plus, SkipBack, SkipForward } from 'lucide-react';
import { formatTime, type Slice } from '../../shared/contracts';
import type { MediaInfo, Thumbnail } from '../lib/media';
import type { Pin } from '../lib/pins';
import ResizeHandle from './ResizeHandle';
import TimelinePin from './TimelinePin';

const MAX_ZOOM = 32;
export default function Timeline({ name, info, thumbnails, pins, time, duration, buffered, selection, height, maxHeight, onHeight, onPin, onMovePin, onRemovePin, onSeek }: {
  name: string; info: MediaInfo | null; thumbnails: Thumbnail[]; pins: Pin[]; time: number; duration: number;
  buffered: { start: number; end: number }[]; selection: Slice | null; height: number; maxHeight: number;
  onHeight: (height: number) => void; onPin: () => void; onMovePin: (id: string, time: number) => void;
  onRemovePin: (id: string) => void; onSeek: (time: number) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomValue = useRef(1);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ time: number; x: number } | null>(null);
  const anchor = useRef<{ ratio: number; x: number } | null>(null);
  const changeZoom = useCallback((value: number, x?: number) => {
    const scroll = viewport.current;
    const next = Math.max(1, Math.min(MAX_ZOOM, value));
    if (!scroll || next === zoomValue.current) return;
    const offset = x ?? scroll.clientWidth / 2;
    anchor.current = { ratio: (scroll.scrollLeft + offset) / scroll.scrollWidth, x: offset };
    zoomValue.current = next; setZoom(next); setHover(null);
  }, []);
  useLayoutEffect(() => {
    const scroll = viewport.current;
    if (scroll && anchor.current) scroll.scrollLeft = anchor.current.ratio * scroll.scrollWidth - anchor.current.x;
    anchor.current = null;
  }, [zoom]);
  useEffect(() => {
    const scroll = viewport.current;
    if (!scroll) return;
    const observer = new ResizeObserver(() => setWidth(scroll.clientWidth));
    observer.observe(scroll);
    const wheel = (event: WheelEvent) => {
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.clientWidth : 1);
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        changeZoom(zoomValue.current * Math.exp(-delta * 0.002), Math.max(0, Math.min(scroll.clientWidth, event.clientX - scroll.getBoundingClientRect().left)));
      } else if (zoomValue.current > 1 && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault(); scroll.scrollLeft += delta;
      }
    };
    scroll.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); scroll.removeEventListener('wheel', wheel); };
  }, [changeZoom]);
  const zoomAtPlayhead = (value: number) => {
    const scroll = viewport.current;
    const x = scroll && duration ? time / duration * scroll.scrollWidth - scroll.scrollLeft : -1;
    changeZoom(value, scroll && x >= 0 && x <= scroll.clientWidth ? x : undefined);
  };
  const progress = duration ? Math.max(0, Math.min(100, time / duration * 100)) : 0;
  const contentWidth = width * zoom;
  const rawStep = duration / Math.max(1, contentWidth / 100);
  const power = 10 ** Math.floor(Math.log10(rawStep || 1));
  const tickStep = ([1, 2, 5, 10].find(multiplier => multiplier * power >= rawStep) || 10) * power;
  const ticks = duration ? Array.from({ length: Math.ceil(duration / tickStep) }, (_, index) => index * tickStep)
    .filter(value => value === 0 || (duration - value) / duration * contentWidth > 65).concat(duration) : [0];
  const hoveredFrame = hover === null ? null : thumbnails.reduce<Thumbnail | null>((nearest, frame) => !nearest || Math.abs(frame.time - hover.time) < Math.abs(nearest.time - hover.time) ? frame : nearest, null);

  return <div className="timeline-section" ref={section} style={{ height }}>
    <ResizeHandle orientation="horizontal" label="Resize timeline" value={height} min={118} max={maxHeight} onChange={onHeight} />
    <div className="timeline-heading"><span className="eyebrow">TIMELINE <span className="subtle">/ 1 VIDEO</span></span>
      <div className="timeline-actions">
        <div className="timeline-zoom" role="group" aria-label="Timeline zoom">
          <button className="icon-button small" aria-label="Zoom out timeline" title="Zoom out" disabled={zoom <= 1 || !duration} onClick={() => zoomAtPlayhead(zoom / 1.5)}><Minus size={13} /></button>
          <input className="timeline-zoom-slider" type="range" aria-label="Timeline zoom" aria-valuetext={`${Number(zoom.toFixed(1))} times magnification`} min="1" max={MAX_ZOOM} step="0.1" value={zoom} disabled={!duration} onChange={event => zoomAtPlayhead(Number(event.target.value))} />
          <button className="text-button zoom-fit" aria-label="Fit timeline" title="Fit entire video · Ctrl + wheel to zoom" onClick={() => changeZoom(1)}>{zoom === 1 ? 'Fit' : `${Number(zoom.toFixed(1))}×`}</button>
          <button className="icon-button small" aria-label="Zoom in timeline" title="Zoom in" disabled={zoom >= MAX_ZOOM || !duration} onClick={() => zoomAtPlayhead(zoom * 1.5)}><Plus size={13} /></button>
        </div>
        <button className="icon-button small" aria-label="Previous pin" disabled={!pins.some(pin => pin.time < time - 0.05)} onClick={() => onSeek([...pins].reverse().find(pin => pin.time < time - 0.05)?.time || 0)}><SkipBack size={14} /></button>
        <button className="icon-button small" aria-label="Next pin" disabled={!pins.some(pin => pin.time > time + 0.05)} onClick={() => onSeek(pins.find(pin => pin.time > time + 0.05)?.time || 0)}><SkipForward size={14} /></button>
        <button className="button small" disabled={!duration} onClick={onPin}><PinIcon size={13} /> Add pin <kbd>P</kbd></button>
      </div>
    </div>
    <div className="timeline-scroll" ref={viewport} tabIndex={0} aria-label="Scrollable timeline" data-zoom={zoom} onScroll={() => setHover(null)}>
      <div className="timeline-content" style={{ width: `${zoom * 100}%` }}>
        <div className="timeline-ruler" aria-hidden="true">{ticks.map((value, index) => <span key={value} style={{ left: `${duration ? value / duration * 100 : 0}%`, transform: `translateX(${index === 0 ? 0 : index === ticks.length - 1 ? -100 : -50}%)` }}>{formatTime(value, tickStep < 1)}</span>)}</div>
        <div className="timeline-track" ref={track} onPointerMove={event => {
          if (!duration || (event.target as HTMLElement).closest('.timeline-marker')) { setHover(null); return; }
          const rect = event.currentTarget.getBoundingClientRect();
          setHover({ time: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration,
            x: event.clientX - (section.current?.getBoundingClientRect().left || 0) });
        }} onPointerLeave={() => setHover(null)}>
          <div className="filmstrip" aria-hidden="true">{thumbnails.length ? thumbnails.map(frame => <img key={frame.time} src={frame.url} alt="" draggable={false} />) : <div className="filmstrip-placeholder">{duration ? name : 'Loading video…'}</div>}</div>
          <div className="timeline-shade" style={{ width: `${progress}%` }} />
          {selection && duration > 0 && selection.end > selection.start && <div className="selection-overlay" style={{ left: `${selection.start / duration * 100}%`, width: `${(selection.end - selection.start) / duration * 100}%` }} />}
          <div className="buffer-track" aria-hidden="true">{buffered.map((range, index) => <span key={index} style={{ left: `${range.start / duration * 100}%`, width: `${(range.end - range.start) / duration * 100}%` }} />)}</div>
          <input className="timeline-input" type="range" aria-label="Video timeline" aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`} min="0" max={duration || 1} step="0.01" value={Math.min(time, duration || 1)} disabled={!duration} onChange={event => onSeek(Number(event.target.value))} />
          <div className="playhead" style={{ left: `${progress}%` }} aria-hidden="true"><span /></div>
          {duration > 0 && pins.filter(pin => pin.time <= duration).map((pin, index) => <TimelinePin key={pin.id} pin={pin} number={index + 1} duration={duration} fps={info?.fps || 30} track={track} viewport={viewport} onMove={onMovePin} onRemove={onRemovePin} onSeek={onSeek} />)}
        </div>
      </div>
    </div>
    {hover && hoveredFrame && <div className="hover-preview" style={{ left: Math.max(75, Math.min(width - 55, hover.x)) }}><img src={hoveredFrame.url} alt="Timeline preview" /><span>{formatTime(hover.time)}</span></div>}
    <span id="pin-help" className="sr-only">Drag to move. Arrow keys move one frame, Shift moves one second. Delete or Backspace removes the pin. Escape cancels a drag.</span>
    <div className="timeline-footer"><span className="source-name">{name}</span><span>{info ? `${info.width} × ${info.height} · ${info.fps.toFixed(2)} fps · ${info.codec.toUpperCase()}` : 'Reading media…'}</span></div>
  </div>;
}
