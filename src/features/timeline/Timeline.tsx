import './styles.css';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Clapperboard, Minus, Plus, SkipBack, SkipForward } from 'lucide-react';
import { formatTime, type Slice } from '../../../shared/contracts';
import type { MediaInfo, Thumbnail } from '../../media/media';
import { isGenerating, playableResult, type Interstitial } from '../../../shared/interstitials';
import type { TimelineComposition } from '../../media/TimelineComposition';
import { TIMELINE_FPS } from '../../../shared/constants';
import ResizeHandle from '../../shared/ResizeHandle';
import InterstitialMarker from './InterstitialMarker';
import VideoFilmstrip from './VideoFilmstrip';
import CrossfadeMarks from './CrossfadeMarks';
import { phaseLabel } from '../interstitials/status';
import FlowTracks, { type FlowTimeline } from './FlowTracks';
import { flowLayout } from '../call-response/model';
import InterstitialHelp from '../interstitials/InterstitialHelp';

const MAX_ZOOM = 32;
export default function Timeline({ name, info, thumbnails, interstitials, selectedId, composition, time, duration, buffered, selection, height, maxHeight, onHeight, onAddInterstitial, onMoveInterstitial, onRemoveInterstitial, onSelectInterstitial, onSeek, callResponse }: {
  name: string; info: MediaInfo | null; thumbnails: Thumbnail[]; interstitials: Interstitial[]; selectedId: string | null; composition: TimelineComposition | null; time: number; duration: number;
  buffered: { start: number; end: number }[]; selection: Slice | null; height: number; maxHeight: number;
  onHeight: (height: number) => void; onAddInterstitial: () => void; onMoveInterstitial: (id: string, time: number) => void;
  onRemoveInterstitial: (id: string) => void; onSelectInterstitial: (id: string | null, time?: number) => void; onSeek: (time: number) => void;
  callResponse?: FlowTimeline;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomValue = useRef(1);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ time: number; x: number } | null>(null);
  const anchor = useRef<{ ratio: number; x: number } | null>(null);
  const markers = interstitials.map(item => ({ ...item, time: callResponse ? (() => { const scene = callResponse.flow.scenes.find(scene => scene.interstitialId === item.id); return scene ? flowLayout(callResponse.flow).starts[scene.id] / callResponse.flow.fps : item.time; })() : composition?.itemTime(item) ?? item.time }));
  const sourceHover = hover ? composition?.sourceTime(hover.time) ?? hover.time : 0;
  const childIds = new Set(callResponse?.flow.scenes.flatMap(scene => scene.interstitialId ? [scene.interstitialId] : []));
  const interstitialCount = interstitials.filter(item => !childIds.has(item.id) && playableResult(item)).length + (callResponse ? 1 : 0);
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
  const contentWidth = (callResponse ? Math.max(1000, width) : width) * zoom;
  const rawStep = duration / Math.max(1, contentWidth / 100);
  const power = 10 ** Math.floor(Math.log10(rawStep || 1));
  const tickStep = ([1, 2, 5, 10].find(multiplier => multiplier * power >= rawStep) || 10) * power;
  const ticks = duration ? Array.from({ length: Math.ceil(duration / tickStep) }, (_, index) => index * tickStep)
    .filter(value => value === 0 || (duration - value) / duration * contentWidth > 65).concat(duration) : [0];
  const hoveredFrame = hover === null || composition?.at(hover.time)?.kind === 'interstitial' ? null : thumbnails.reduce<Thumbnail | null>((nearest, frame) => !nearest || Math.abs(frame.time - sourceHover) < Math.abs(nearest.time - sourceHover) ? frame : nearest, null);

  return <div className={`timeline-section ${callResponse ? 'has-flow' : ''}`} ref={section} style={{ height }}>
    <ResizeHandle orientation="horizontal" label="Resize timeline" value={height} min={134} max={maxHeight} onChange={onHeight} />
    <div className="timeline-heading"><span className="eyebrow">TIMELINE <span className="subtle">/ {interstitialCount} {interstitialCount === 1 ? 'INTERSTITIAL' : 'INTERSTITIALS'}</span></span>
      <div className="timeline-actions">
        <div className="timeline-zoom" role="group" aria-label="Timeline zoom">
          <button className="icon-button small" aria-label="Zoom out timeline" title="Zoom out" disabled={zoom <= 1 || !duration} onClick={() => zoomAtPlayhead(zoom / 1.5)}><Minus size={13} /></button>
          <input className="timeline-zoom-slider" type="range" aria-label="Timeline zoom" aria-valuetext={`${Number(zoom.toFixed(1))} times magnification`} min="1" max={MAX_ZOOM} step="0.1" value={zoom} disabled={!duration} onChange={event => zoomAtPlayhead(Number(event.target.value))} />
          <button className="text-button zoom-fit" aria-label="Fit timeline" title="Fit entire video · Ctrl + wheel to zoom" onClick={() => changeZoom(1)}>{zoom === 1 ? 'Fit' : `${Number(zoom.toFixed(1))}×`}</button>
          <button className="icon-button small" aria-label="Zoom in timeline" title="Zoom in" disabled={zoom >= MAX_ZOOM || !duration} onClick={() => zoomAtPlayhead(zoom * 1.5)}><Plus size={13} /></button>
        </div>
        <button className="icon-button small" aria-label="Previous interstitial" disabled={!markers.some(item => item.time < time - 0.05)} onClick={() => onSelectInterstitial([...markers].reverse().find(item => item.time < time - 0.05)?.id ?? null)}><SkipBack size={14} /></button>
        <button className="icon-button small" aria-label="Next interstitial" disabled={!markers.some(item => item.time > time + 0.05)} onClick={() => onSelectInterstitial(markers.find(item => item.time > time + 0.05)?.id ?? null)}><SkipForward size={14} /></button>
        <div className="interstitial-add-actions">
          <button className="button small" disabled={!info || !!callResponse} onClick={onAddInterstitial}><Clapperboard size={13} /> Add interstitial <kbd>P</kbd></button>
          <InterstitialHelp />
        </div>
      </div>
    </div>
    <div className="timeline-scroll" ref={viewport} tabIndex={0} aria-label="Scrollable timeline" data-zoom={zoom} onScroll={() => setHover(null)}>
      <div className="timeline-content" style={{ width: callResponse ? contentWidth : `${zoom * 100}%` }} onClick={event => {
        if (!duration || event.detail === 0) return;
        const control = (event.target as HTMLElement).closest('button, input, a, [role="button"]');
        if (control && !control.classList.contains('timeline-interstitial-container')) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width) onSeek(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration);
      }}>
        <div className="timeline-ruler" aria-hidden="true">{ticks.map((value, index) => <span key={value} style={{ left: `${duration ? value / duration * 100 : 0}%`, transform: `translateX(${index === 0 ? 0 : index === ticks.length - 1 ? -100 : -50}%)` }}>{formatTime(value, tickStep < 1)}</span>)}</div>
        {callResponse ? <FlowTracks value={callResponse} width={contentWidth} /> : <div className="timeline-track-space"><div className="timeline-track" ref={track} onPointerMove={event => {
          if (!duration || (event.target as HTMLElement).closest('.timeline-marker')) { setHover(null); return; }
          const rect = event.currentTarget.getBoundingClientRect();
          setHover({ time: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration,
            x: event.clientX - (section.current?.getBoundingClientRect().left || 0) });
        }} onPointerLeave={() => setHover(null)}>
          <div className="filmstrip" aria-hidden="true">{composition?.hasInsertions ? composition.segments.filter(segment => segment.kind === 'source').map(segment => <div className="source-segment" key={segment.id} style={{ left: `${segment.startFrame / composition.fps / duration * 100}%`, width: `${(segment.endFrame - segment.startFrame) / composition.fps / duration * 100}%` }}><VideoFilmstrip url={segment.source.url} start={segment.sourceStart} end={segment.sourceStart + (segment.endFrame - segment.startFrame) / composition.fps} width={(segment.endFrame - segment.startFrame) / composition.fps / duration * contentWidth} /></div>) : thumbnails.length ? thumbnails.map(frame => <img key={frame.time} src={frame.url} alt="" draggable={false} />) : <div className="filmstrip-placeholder">{duration ? name : 'Loading video…'}</div>}</div>
          <div className="timeline-shade" style={{ width: `${progress}%` }} />
          {selection && duration > 0 && selection.end > selection.start && <div className="selection-overlay" style={{ left: `${(composition?.timelineTime(selection.start) ?? selection.start) / duration * 100}%`, width: `${((composition?.timelineTime(selection.end) ?? selection.end) - (composition?.timelineTime(selection.start) ?? selection.start)) / duration * 100}%` }} />}
          <div className="buffer-track" aria-hidden="true">{buffered.map((range, index) => <span key={index} style={{ left: `${range.start / duration * 100}%`, width: `${(range.end - range.start) / duration * 100}%` }} />)}</div>
          <input className="timeline-input" type="range" aria-label="Video timeline" aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`} min="0" max={duration || 1} step={1 / TIMELINE_FPS} value={Math.min(time, duration || 1)} disabled={!duration} onChange={event => onSeek(Number(event.target.value))} />
          {composition?.segments.filter(segment => segment.kind === 'interstitial').map(segment => {
            const item = interstitials.find(item => item.id === segment.id);
            const busy = item && isGenerating(item);
            return <button key={segment.id} className={`rendered-interstitial ${selectedId === segment.id ? 'selected' : ''} ${busy ? 'generating' : ''}`} aria-label={`Select rendered ${segment.label}`} title={`${segment.label} · ${busy ? phaseLabel(item) : `${((segment.endFrame - segment.startFrame) / composition.fps).toFixed(2)}s`}`}
            style={{ left: `${segment.startFrame / composition.fps / duration * 100}%`, width: `${(segment.endFrame - segment.startFrame) / composition.fps / duration * 100}%` }} onClick={event => {
              const rect = track.current?.getBoundingClientRect();
              // Keyboard selection uses the anchor; pointer clicks seek within the expanded timeline.
              if (event.detail === 0 || !rect?.width) { onSelectInterstitial(segment.id); return; }
              const frame = Math.round((event.clientX - rect.left) / rect.width * duration * composition.fps);
              onSelectInterstitial(segment.id, Math.max(segment.startFrame, Math.min(segment.endFrame - 1, frame)) / composition.fps);
            }}><VideoFilmstrip url={segment.source.url} start={segment.sourceStart} end={segment.sourceStart + (segment.endFrame - segment.startFrame) / composition.fps} width={(segment.endFrame - segment.startFrame) / composition.fps / duration * contentWidth} />{busy && <span className="spinner timeline-generation-spinner" role="status" aria-label={`${segment.label}: ${phaseLabel(item)}`} />}</button>;
          })}
          {composition && <CrossfadeMarks composition={composition} width={contentWidth} />}
          <div className="playhead" style={{ left: `${progress}%` }} aria-hidden="true"><span /></div>
          {duration > 0 && markers.filter(item => item.time <= duration).map((item, index) => {
            const segment = composition?.segments.find(segment => segment.kind === 'interstitial' && segment.id === item.id);
            const sceneDuration = segment && composition ? (segment.endFrame - segment.startFrame) / composition.fps : 0;
            return <InterstitialMarker key={item.id} pin={item} selected={selectedId === item.id} number={index + 1} sceneDuration={sceneDuration} duration={duration} fps={TIMELINE_FPS} track={track} viewport={viewport} onMove={onMoveInterstitial} onRemove={onRemoveInterstitial} onSelect={onSelectInterstitial} />;
          })}
        </div></div>}
      </div>
    </div>
    {hover && hoveredFrame && <div className="hover-preview" style={{ left: Math.max(75, Math.min(width - 55, hover.x)) }}><img src={hoveredFrame.url} alt="Timeline preview" /><span>{formatTime(hover.time)}</span></div>}
    <span id="pin-help" className="sr-only">Select to edit. Drag to move unless generation is in progress. Arrow keys move one frame, Shift moves one second. Delete or Backspace removes the interstitial. Escape cancels a drag.</span>
    <div className="timeline-footer"><span className="source-name">{name}{callResponse ? ' · One idle cycle shown · total duration varies' : ''}</span><span>{info ? `${info.width} × ${info.height} · ${TIMELINE_FPS} fps · ${info.codec.toUpperCase()}` : 'Reading media…'}</span></div>
  </div>;
}
