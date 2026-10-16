import './styles.css';
import { useRef } from 'react';
import { ArrowLeft, Clapperboard, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { INTERSTITIAL } from '../../../shared/constants';
import { formatTime, type AppStatus } from '../../../shared/contracts';
import { isGenerating, referenceRange, type Interstitial } from '../../../shared/interstitials';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import type { InterstitialController } from './InterstitialController';

function RemoveInterstitialButton({ item, controller }: { item: Interstitial; controller: InterstitialController }) {
  const handledTouch = useRef(false);
  return <button className="icon-button small" aria-label={`Remove ${item.label}`}
    onPointerDown={() => { handledTouch.current = false; }}
    onPointerUp={event => {
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
      // A tap immediately after a captured timeline drag may have no synthesized click.
      handledTouch.current = true; event.preventDefault(); void controller.remove(item.id);
    }} onClick={event => {
      if (handledTouch.current && event.detail !== 0) { handledTouch.current = false; return; }
      handledTouch.current = false; void controller.remove(item.id);
    }}><Trash2 size={14} /></button>;
}

export const phaseLabel = (item: Interstitial) => ({ draft: 'Draft', preparing: `Preparing reference${item.progress === undefined ? '' : ` · ${Math.round(item.progress * 100)}%`}`,
  uploading: 'Uploading reference', queued: item.queuePosition === undefined ? 'Queued' : `Queued · position ${item.queuePosition + 1}`, rendering: 'Generating scene',
  loading: 'Loading generated video', ready: 'Ready', error: 'Needs attention', cancelled: 'Cancelled' }[item.phase]);

export default function InterstitialPanel({ items, selectedId, controller, engine, info, status, onAdd, onSelect, onPreview }: {
  items: Interstitial[]; selectedId: string | null; controller: InterstitialController; engine: MediaEngine | null; info: MediaInfo | null; status: AppStatus | null;
  onAdd: () => void; onSelect: (id: string | null) => void; onPreview: (item: Interstitial) => void;
}) {
  const selected = items.find(item => item.id === selectedId);
  if (!selected) return <div className="panel-content interstitial-panel">
    <div className="panel-intro"><h2>Interstitials</h2><p>Draft and generated scenes at points in your video.</p></div>
    <button className="button full-width" disabled={!info} onClick={onAdd}><Plus size={14} /> New interstitial at playhead</button>
    {!items.length ? <div className="empty-state"><h3>No interstitials yet</h3><p>Press <kbd>P</kbd> to add a draft at the playhead.</p></div> : <ol className="interstitial-list">{items.map((item, i) => <li key={item.id}>
      <button className={`interstitial-row ${item.phase === 'ready' ? 'ready' : ''}`} onClick={() => onSelect(item.id)} aria-label={`Select ${item.label}`}>
        <span className="interstitial-number">{i + 1}</span><span className="interstitial-row-content"><strong>{item.label}</strong><span>{formatTime(item.time, true)} · {phaseLabel(item)}</span></span>
        {isGenerating(item) && <span className="spinner" />}{item.phase === 'ready' && <Clapperboard size={14} />}
      </button><RemoveInterstitialButton item={item} controller={controller} />
    </li>)}</ol>}
  </div>;
  const busy = isGenerating(selected);
  const locked = busy || selected.phase === 'ready' || !!selected.requestId;
  let range: ReturnType<typeof referenceRange> | null = null, rangeError = '';
  if (info) try { range = referenceRange(selected, info.duration); } catch (error) { rangeError = (error as Error).message; }
  return <div className="panel-content interstitial-panel">
    <button className="text-button interstitial-back" onClick={() => onSelect(null)}><ArrowLeft size={13} /> All interstitials</button>
    <div className="interstitial-title"><h2>{selected.label}</h2><RemoveInterstitialButton item={selected} controller={controller} /></div>
    <p className="hint">{selected.phase === 'ready' ? 'Inserted scene' : 'Interstitial draft'} at {formatTime(selected.time, true)} in the source video.</p>
    <form onSubmit={event => { event.preventDefault(); if (engine && info) void controller.generate(selected.id, engine, info); }}>
      <fieldset disabled={locked}>
        <div className="range-fields">
          <label className="field">start_range <span className="unit">seconds before</span><input aria-label="start_range" type="number" min={INTERSTITIAL.minStartRange} max={INTERSTITIAL.maxRange} step="any" required value={Number.isFinite(selected.start_range) ? selected.start_range : ''} onChange={event => controller.edit(selected.id, { start_range: event.target.valueAsNumber })} /></label>
          <label className="field">end_range <span className="unit">seconds after</span><input aria-label="end_range" type="number" min={INTERSTITIAL.minEndRange} max={INTERSTITIAL.maxRange} step="any" required value={Number.isFinite(selected.end_range) ? selected.end_range : ''} onChange={event => controller.edit(selected.id, { end_range: event.target.valueAsNumber })} /></label>
        </div>
        <label className="field">Prompt<textarea aria-label="Interstitial prompt" rows={5} required maxLength={4000} placeholder="Describe the scene to insert…" value={selected.prompt} onChange={event => controller.edit(selected.id, { prompt: event.target.value })} /></label>
      </fieldset>
      {!locked && <>
        {range && <p className="hint">Reference: {formatTime(range.start, true)}–{formatTime(range.end, true)}. Adds a {INTERSTITIAL.generatedSeconds}s scene; original footage is preserved.</p>}
        {rangeError && <p className="inline-error" role="alert">{rangeError}</p>}
        <p className="hint">Uses fal.ai credits. {status?.providers.fal ? '' : 'Configure FAL_KEY to enable generation.'}</p>
        <button type="submit" className="button primary full-width" disabled={!engine || !info || !status?.providers.fal || !!rangeError || !selected.prompt.trim()}><Clapperboard size={14} /> Generate</button>
      </>}
    </form>
    {busy && <div className="task-status" role="status"><span className="spinner" /><span>{phaseLabel(selected)}</span><button className="icon-button small" aria-label="Cancel interstitial generation" onClick={() => void controller.cancel(selected.id)}><X size={14} /></button></div>}
    {selected.phase === 'preparing' && <progress className="interstitial-progress" aria-label="Preparing reference" max="1" value={selected.progress || 0} />}
    {selected.error && <p className="inline-error" role="alert">{selected.error}</p>}
    {selected.phase === 'ready' && <div className="interstitial-ready"><p>{selected.result?.duration.toFixed(2)}s interstitial · ready in the timeline</p><button className="button full-width" onClick={() => onPreview(selected)}>Play interstitial</button></div>}
    {selected.phase === 'error' && (selected.requestId || selected.result) && <button className="button full-width" onClick={() => void controller.resume(selected.id)}><RotateCcw size={13} /> Retry status / loading</button>}
    {['error', 'cancelled'].includes(selected.phase) && <button className="text-button" onClick={() => controller.reset(selected.id)}>Return to draft</button>}
  </div>;
}
