import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { DiamondPlus, Trash2 } from 'lucide-react';
import { FADE_PRESETS, MAX_FADE_POINTS, fadeMix, fadePreset, isLinearFade, linearFade, type FadeCurve } from '../../../shared/fade-curves';
import InterstitialTimeField from '../interstitials/InterstitialTimeField';
import { fadeAxisSpan, handlePoint, insertFadePoint, moveFadeHandle, moveFadePoint, nextPointPosition, removeFadePoint, type HandleSide } from './fadeCurveEditing';
import './crossfade-curve.css';

type Props = {
  /** Prefix for accessible names, such as "Video crossfade". */
  name: string; label: string;
  duration: number; max: number; step: number;
  curve?: FadeCurve;
  /** Fraction of the fade where the clips cut, when playback knows it. */
  cut?: number;
  disabled?: boolean;
  onDuration: (seconds: number) => void;
  /** Linear curves are reported as undefined so saved connections stay minimal. */
  onCurve: (curve: FadeCurve | undefined) => void;
  /** Separates drags, presets and point edits in undo history. Typing and arrow nudges merge. */
  onBoundary?: () => void;
};
type Target = { kind: 'end' } | { kind: 'point'; index: number } | { kind: 'handle'; index: number; side: HandleSide };
type Draft = { duration: number; curve: FadeCurve; span: number };

const HEIGHT = 112, LEFT = 30, RIGHT_PAD = 10, TOP = 15, BOTTOM_PAD = 18, SAMPLES = 96;
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const diamond = (x: number, y: number, r: number) => `M${x},${y - r}l${r},${r} ${-r},${r} ${-r},${-r}Z`;
const tick = (seconds: number) => `${Number(seconds.toFixed(2))}s`;

function PresetIcon({ curve }: { curve: FadeCurve }) {
  const d = Array.from({ length: 17 }, (_, i) => `${i ? 'L' : 'M'}${(1 + i / 16 * 14).toFixed(2)},${(11 - fadeMix(curve, i / 16) * 10).toFixed(2)}`).join('');
  return <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden><path d={d}/></svg>;
}

/** A crossfade as a graph: the end point sets the duration and the points between shape the blend. */
export default function CrossfadeCurveField({ name, label, duration: savedDuration, max, step, curve: savedCurve, cut, disabled = false, onDuration, onCurve, onBoundary }: Props) {
  const container = useRef<HTMLDivElement>(null), graph = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(240), [selected, setSelected] = useState<number | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const latest = useRef<Draft | null>(null), drag = useRef<{ target: Target; changed: boolean } | null>(null);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(160, Math.round(entry.contentRect.width))));
    observer.observe(container.current!); return () => observer.disconnect();
  }, []);
  const saved = { duration: savedDuration, curve: savedCurve ?? linearFade() };
  const { duration, curve, span } = draft ?? { ...saved, span: fadeAxisSpan(savedDuration, max) };
  const last = curve.points.length - 1, active = selected !== null && selected <= last ? selected : null;
  const right = width - RIGHT_PAD, bottom = HEIGHT - BOTTOM_PAD;
  const x = (time: number) => LEFT + time / span * (right - LEFT), y = (level: number) => bottom - level * (bottom - TOP);
  const timeOf = (position: number) => position * duration;
  const pointer = (event: { clientX: number; clientY: number }) => {
    const box = graph.current!.getBoundingClientRect();
    return { time: clamp(((event.clientX - box.left) / box.width * width - LEFT) / (right - LEFT) * span, 0, span),
      level: clamp((bottom - (event.clientY - box.top) / box.height * HEIGHT) / (bottom - TOP)) };
  };
  const fadePath = (level: (mix: number) => number) => duration > 0
    ? Array.from({ length: SAMPLES + 1 }, (_, i) => `${i ? 'L' : 'M'}${x(duration * i / SAMPLES).toFixed(2)},${y(level(fadeMix(curve, i / SAMPLES))).toFixed(2)}`).join('')
    : `M${x(0)},${y(level(0))}L${x(0)},${y(level(1))}`;
  // Each clip holds its final level for the rest of the graph.
  const levelPath = (level: (mix: number) => number) => `${fadePath(level)}L${x(span).toFixed(2)},${y(level(1)).toFixed(2)}`;
  const cutX = cut !== undefined && duration > 0 ? x(timeOf(cut)) : undefined, cutLeft = cutX !== undefined && cutX > (LEFT + right) / 2;
  const legend = cutLeft ? LEFT : right - 74;

  const emitCurve = (next: FadeCurve) => onCurve(isLinearFade(next) ? undefined : next);
  const commit = (next: { duration?: number; curve?: FadeCurve }) => {
    onBoundary?.();
    if (next.duration !== undefined && next.duration !== saved.duration) onDuration(next.duration);
    else if (next.curve && !same(next.curve, saved.curve)) emitCurve(next.curve);
    onBoundary?.();
  };
  const update = (next: Draft | null) => { latest.current = next; setDraft(next); };
  const begin = (event: ReactPointerEvent<SVGElement>, target: Target, start: { duration: number; curve: FadeCurve } = { duration, curve }, changed = false) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    (target.kind === 'point' && changed ? graph.current! : event.currentTarget).focus({ preventScroll: true });
    drag.current = { target, changed }; update({ ...start, span });
    graph.current!.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = drag.current, base = latest.current;
    if (!current || !base) return;
    const { time, level } = pointer(event), { target } = current;
    current.changed = true;
    if (target.kind === 'end') update({ ...base, duration: clamp(Math.round(time / step) * step, 0, Math.min(max, base.span)) });
    else if (base.duration > 0) update({ ...base, curve: target.kind === 'point'
      ? moveFadePoint(base.curve, target.index, time / base.duration, level)
      : moveFadeHandle(base.curve, target.index, target.side, time / base.duration, level) });
  };
  const end = (cancel = false) => {
    const current = drag.current, result = latest.current;
    drag.current = null; update(null);
    if (!current || !result || cancel || !current.changed) return;
    commit(current.target.kind === 'end' ? { duration: result.duration } : { curve: result.curve });
  };
  const addPoint = (position = nextPointPosition(curve), level?: number) => {
    const added = insertFadePoint(curve, position, level);
    if (!added) return;
    setSelected(added.index); commit({ curve: added.curve });
  };
  const deletePoint = () => {
    if (active === null || active === 0 || active === last) return;
    setSelected(null); commit({ curve: removeFadePoint(curve, active) }); graph.current?.focus({ preventScroll: true });
  };
  const keys = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (disabled) return;
    const consume = () => { event.preventDefault(); event.stopPropagation(); };
    if (event.key === 'Escape' && (drag.current || active !== null)) { consume(); if (drag.current) end(true); else setSelected(null); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { consume(); deletePoint(); return; }
    if (active === null || drag.current) return;
    const scale = event.shiftKey ? 10 : 1;
    const horizontal = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0, vertical = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
    if (active === last) {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? max : horizontal || vertical ? duration + (horizontal || vertical) * step * scale : undefined;
      if (next === undefined) return;
      consume(); onDuration(clamp(Math.round(next / step) * step, 0, max)); return;
    }
    if (active === 0 || duration <= 0 || !(horizontal || vertical)) return;
    const point = curve.points[active];
    consume(); emitCurve(moveFadePoint(curve, active, (timeOf(point.position) + horizontal * step * scale) / duration, point.strength + vertical * .01 * scale));
  };
  const handleKeys = (index: number, side: HandleSide, position: number, strength: number) => (event: ReactKeyboardEvent<SVGElement>) => {
    const scale = event.shiftKey ? 10 : 1;
    const horizontal = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0, vertical = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
    if (disabled || !(horizontal || vertical)) return;
    event.preventDefault(); event.stopPropagation();
    emitCurve(moveFadeHandle(curve, index, side, position + horizontal * .02 * scale, strength + vertical * .01 * scale));
  };

  const shown = active !== null && duration > 0;
  return <div className="crossfade-curve" data-disabled={disabled || undefined}>
    <InterstitialTimeField name={`${name} duration`} label={label} min={0} max={max} step={step} value={Number(duration.toFixed(3))} disabled={disabled}
      onChange={value => Number.isFinite(value) && onDuration(value)}/>
    <div className="crossfade-curve-graph" ref={container}>
      <svg ref={graph} viewBox={`0 0 ${width} ${HEIGHT}`} role="group" aria-label={`${name} curve`} tabIndex={disabled ? -1 : 0}
        aria-description="Drag the end point to change the duration. Click the curve to add a point, then drag points or their handles to shape the fade."
        onKeyDown={keys} onPointerMove={move} onPointerUp={() => end()} onPointerCancel={() => end(true)}
        onPointerDown={event => { if (!disabled && event.button === 0) { setSelected(null); event.currentTarget.focus({ preventScroll: true }); } }}
        onDoubleClick={event => { if (disabled || duration <= 0) return; const p = pointer(event); if (p.time < duration) addPoint(p.time / duration, p.level); }}>
        <rect className="crossfade-curve-plot" x={LEFT} y={TOP} width={right - LEFT} height={bottom - TOP}/>
        <rect className="crossfade-curve-after" x={x(duration)} y={TOP} width={Math.max(0, right - x(duration))} height={bottom - TOP}/>
        {[0, .5, 1].map(level => <line key={level} className="crossfade-curve-grid" x1={LEFT} x2={right} y1={y(level)} y2={y(level)}/>)}
        {[.25, .5, .75].map(part => <line key={part} className="crossfade-curve-grid" x1={x(span * part)} x2={x(span * part)} y1={TOP} y2={bottom}/>)}
        <text className="crossfade-curve-axis" x={LEFT - 5} y={y(1) + 3} textAnchor="end">100</text>
        <text className="crossfade-curve-axis" x={LEFT - 5} y={y(0) + 3} textAnchor="end">0</text>
        {[0, .5, 1].map(part => <text key={part} className="crossfade-curve-axis" x={x(span * part)} y={HEIGHT - 5} textAnchor={part === 0 ? 'start' : part === 1 ? 'end' : 'middle'}>{tick(span * part)}</text>)}
        <g className="crossfade-curve-legend" aria-hidden>
          <line className="crossfade-curve-out" x1={legend} x2={legend + 12} y1={8} y2={8}/><text className="crossfade-curve-axis" x={legend + 15} y={11}>Out</text>
          <line className="crossfade-curve-in" x1={legend + 40} x2={legend + 52} y1={8} y2={8}/><text className="crossfade-curve-axis" x={legend + 55} y={11}>In</text>
        </g>
        {cutX !== undefined && <g className="crossfade-curve-cut" role="img" aria-label={`Cut at ${timeOf(cut!).toFixed(3)} seconds into the fade`}>
          <line x1={cutX} x2={cutX} y1={TOP} y2={bottom}/>
          <text className="crossfade-curve-axis" x={cutX + (cutLeft ? -3 : 3)} y={TOP - 4} textAnchor={cutLeft ? 'end' : 'start'}>Cut</text>
        </g>}
        <path className="crossfade-curve-out" d={levelPath(mix => 1 - mix)}/>
        <path className="crossfade-curve-in" d={levelPath(mix => mix)}/>
        {duration > 0 && !disabled && <path className="crossfade-curve-hit" d={fadePath(mix => mix)}
          onPointerDown={event => {
            if (event.button !== 0) return;
            const added = insertFadePoint(curve, pointer(event).time / duration);
            if (!added) return;
            setSelected(added.index); begin(event, { kind: 'point', index: added.index }, { duration, curve: added.curve }, true);
          }}/>}
        {shown && (['in', 'out'] as const).map(side => {
          const handle = handlePoint(curve, active, side), point = curve.points[active];
          if (!handle) return null;
          const hx = x(timeOf(handle.position)), hy = y(handle.strength);
          return <g key={side} className="crossfade-curve-handle">
            <line x1={x(timeOf(point.position))} y1={y(point.strength)} x2={hx} y2={hy}/>
            <circle className="crossfade-curve-handle-hit" cx={hx} cy={hy} r={8} role="button" tabIndex={disabled ? -1 : 0}
              aria-label={`${name} ${active === last ? 'end' : `point ${active}`} ${side} handle`}
              onPointerDown={event => begin(event, { kind: 'handle', index: active, side })} onDoubleClick={event => event.stopPropagation()}
              onKeyDown={handleKeys(active, side, handle.position, handle.strength)}><title>Drag to bend the curve</title></circle>
            <circle className="crossfade-curve-handle-dot" cx={hx} cy={hy} r={3}/>
          </g>;
        })}
        {curve.points.map((point, index) => {
          const cx = x(timeOf(point.position)), cy = y(point.strength), chosen = active === index, isEnd = index === last;
          const description = `${timeOf(point.position).toFixed(3)} s, ${Math.round(point.strength * 100)}% incoming`;
          const label = index === 0 ? `${name} start` : isEnd ? `${name} end` : `${name} point ${index}`;
          return <g key={index} className="crossfade-curve-point" data-selected={chosen} data-kind={index === 0 ? 'start' : isEnd ? 'end' : 'point'}>
            <rect className="crossfade-curve-point-hit" x={cx - 9} y={cy - 9} width={18} height={18} tabIndex={disabled ? -1 : 0}
              {...isEnd ? { role: 'slider', 'aria-orientation': 'horizontal' as const, 'aria-valuemin': 0, 'aria-valuemax': Number(max.toFixed(3)),
                'aria-valuenow': Number(duration.toFixed(3)), 'aria-valuetext': `${duration.toFixed(3)} seconds` }
                : { role: 'button', 'aria-pressed': chosen, 'aria-description': description }}
              aria-label={label} onFocus={() => setSelected(index)} onDoubleClick={event => event.stopPropagation()}
              onPointerDown={event => {
                if (disabled || event.button !== 0) return;
                setSelected(index);
                if (index === 0) { event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); }
                else begin(event, isEnd ? { kind: 'end' } : { kind: 'point', index });
              }}>
              <title>{index === 0 ? 'Fade start · select to bend its handle' : isEnd ? `Fade end · ${duration.toFixed(3)} s · drag to change the duration` : `${description} · drag to move, Delete to remove`}</title>
            </rect>
            <path className="crossfade-curve-diamond" d={diamond(cx, cy, index === 0 ? 3.5 : 4.5)}/>
          </g>;
        })}
      </svg>
    </div>
    <div className="crossfade-curve-tools">
      <div className="crossfade-curve-presets" role="group" aria-label={`${name} shape`}>
        {FADE_PRESETS.map(preset => <button type="button" key={preset.id} aria-label={preset.label} title={preset.label} aria-pressed={fadePreset(curve) === preset.id} disabled={disabled}
          onClick={() => { setSelected(null); commit({ curve: preset.curve }); }}><PresetIcon curve={preset.curve}/></button>)}
      </div>
      <button type="button" className="icon-button small" aria-label={`Add ${name.toLowerCase()} point`} title="Add a point in the widest gap"
        disabled={disabled || duration <= 0 || curve.points.length >= MAX_FADE_POINTS} onClick={() => addPoint()}><DiamondPlus size={13}/></button>
      <button type="button" className="icon-button small" aria-label={`Delete ${name.toLowerCase()} point`} title="Delete the selected point"
        disabled={disabled || active === null || active === 0 || active === last} onClick={deletePoint}><Trash2 size={13}/></button>
    </div>
  </div>;
}
