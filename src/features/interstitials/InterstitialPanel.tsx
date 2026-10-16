import './styles.css';
import { useId, useRef } from 'react';
import { ArrowLeft, Clapperboard, Download, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { INTERSTITIAL } from '../../../shared/constants';
import { formatTime, type AppStatus } from '../../../shared/contracts';
import { hasUnsubmittedChanges, isGenerating, playableResult, referenceRange, validateInterstitialDuration, type Interstitial } from '../../../shared/interstitials';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import type { InterstitialController } from './InterstitialController';
import { assets } from '../project/assets';
import { phaseLabel } from './status';

function TimeField({ name, label, unit, value, min, max, step, onChange }: {
  name: string; label: string; unit: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void;
}) {
  const id = useId();
  return <div className="interstitial-time-field">
    <div className="interstitial-time-label"><label htmlFor={id}>{label}</label><span className="unit">{unit}</span></div>
    <div className="interstitial-time-controls">
      <input aria-label={`${label} slider`} type="range" min={min} max={max} step="any"
        value={Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min}
        onChange={event => onChange(Number(event.target.valueAsNumber.toFixed(3)))}
        onKeyDown={event => {
          const direction = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 0;
          if (!direction) return;
          // Preserve typed decimals while keeping keyboard adjustments predictable.
          event.preventDefault();
          onChange(Math.max(min, Math.min(max, Number(((Number.isFinite(value) ? value : min) + direction * step).toFixed(3)))));
        }} />
      <input id={id} aria-label={name} type="number" min={min} max={max} step="any" required
        value={Number.isFinite(value) ? value : ''} onChange={event => onChange(event.target.valueAsNumber)} />
    </div>
  </div>;
}

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

export default function InterstitialPanel({ items, selectedId, controller, engine, info, status, onAdd, onSelect, onPreview }: {
  items: Interstitial[]; selectedId: string | null; controller: InterstitialController; engine: MediaEngine | null; info: MediaInfo | null; status: AppStatus | null;
  onAdd: () => void; onSelect: (id: string | null) => void; onPreview: (item: Interstitial) => void;
}) {
  const selected = items.find(item => item.id === selectedId);
  if (!selected) return <div className="panel-content interstitial-panel">
    <div className="panel-intro"><h2>Interstitials</h2><p>Draft and generated scenes at points in your video.</p></div>
    <button className="button full-width" disabled={!info} onClick={onAdd}><Plus size={14} /> New interstitial at playhead</button>
    {!items.length ? <div className="empty-state"><h3>No interstitials yet</h3><p>Press <kbd>P</kbd> to add a draft at the playhead.</p></div> : <ol className="interstitial-list">{items.map((item, i) => <li key={item.id}>
      <button className={`interstitial-row ${playableResult(item) ? 'ready' : ''}`} onClick={() => onSelect(item.id)} aria-label={`Select ${item.label}`}>
        <span className="interstitial-number">{i + 1}</span><span className="interstitial-row-content"><strong>{item.label}</strong><span>{formatTime(item.time, true)} · {phaseLabel(item)}</span></span>
        {isGenerating(item) && <span className="spinner" />}{playableResult(item) && <Clapperboard size={14} />}
      </button><RemoveInterstitialButton item={item} controller={controller} />
    </li>)}</ol>}
  </div>;
  const busy = isGenerating(selected);
  const currentResult = playableResult(selected);
  const changed = hasUnsubmittedChanges(selected);
  const retryLoading = !busy && !!selected.result && selected.phase !== 'ready' && !changed;
  const action = retryLoading ? 'Retry loading' : selected.phase === 'error' || selected.phase === 'cancelled' ? 'Retry' : currentResult ? 'Regenerate' : 'Generate';
  const fullVideoUrl = currentResult?.assetId ? assets.url(currentResult.assetId) : undefined;
  const downloadName = `${selected.label.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'interstitial'}-full.mp4`;
  let range: ReturnType<typeof referenceRange> | null = null, validationError = '';
  try {
    validateInterstitialDuration(selected.duration);
    if (info) range = referenceRange(selected, info.duration);
  } catch (error) { validationError = (error as Error).message; }
  return <div className="panel-content interstitial-panel">
    <button className="text-button interstitial-back" onClick={() => onSelect(null)}><ArrowLeft size={13} /> All interstitials</button>
    <div className="interstitial-title"><h2>{selected.label}</h2><RemoveInterstitialButton item={selected} controller={controller} /></div>
    <p className="hint">{currentResult ? 'Inserted scene' : 'Interstitial draft'} at {formatTime(selected.time, true)} in the source video.</p>
    {busy && <div className="task-status" role="status"><span className="spinner" /><span>{phaseLabel(selected)}</span><button className="text-button" aria-label="Cancel interstitial generation" onClick={() => void controller.cancel(selected.id)}>Cancel</button></div>}
    {selected.phase === 'preparing' && <progress className="interstitial-progress" aria-label="Preparing reference" max="1" value={selected.progress || 0} />}
    <form onSubmit={event => { event.preventDefault(); if (engine && info) void controller.generate(selected.id, engine, info); }}>
      <fieldset>
        <label className="field">Prompt<textarea aria-label="Interstitial prompt" rows={4} required maxLength={4000} placeholder="Describe the scene to insert…" value={selected.prompt} onChange={event => controller.edit(selected.id, { prompt: event.target.value })} /></label>
        <div className="interstitial-time-fields">
          <TimeField name="start_range" label="Start range" unit="seconds before" value={selected.start_range} min={INTERSTITIAL.minStartRange} max={INTERSTITIAL.maxRange} step={0.025} onChange={value => controller.edit(selected.id, { start_range: value })} />
          <TimeField name="end_range" label="End range" unit="seconds after" value={selected.end_range} min={INTERSTITIAL.minEndRange} max={INTERSTITIAL.maxRange} step={0.1} onChange={value => controller.edit(selected.id, { end_range: value })} />
          <TimeField name="Duration" label="Duration" unit="seconds generated" value={selected.duration} min={INTERSTITIAL.minDuration} max={INTERSTITIAL.maxDuration} step={0.25} onChange={value => controller.edit(selected.id, { duration: value })} />
        </div>
        <label className="interstitial-option"><input type="checkbox" checked={selected.enable_prompt_expansion} aria-describedby="prompt-expansion-help"
          onChange={event => controller.edit(selected.id, { enable_prompt_expansion: event.target.checked })} /> Prompt expansion</label>
        <p id="prompt-expansion-help" className="hint">Let fal.ai expand the submitted prompt.</p>
      </fieldset>
      {range && <p className="hint">Reference: {formatTime(range.start, true)}–{formatTime(range.end, true)}. Adds a {selected.duration}s scene.</p>}
      {validationError && <p className="inline-error" role="alert">{validationError}</p>}
      <p className="hint interstitial-edit-hint">{changed ? 'Changes saved for the next generation.' : busy ? 'You can keep editing while this version generates.' : currentResult ? 'Edit settings and regenerate to replace the current video.' : 'Settings save automatically.'}</p>
      {selected.error && <p className="inline-error" role="alert">{selected.error}</p>}
      {selected.phase === 'cancelled' && <p className="hint">Generation cancelled. Edit and retry whenever you’re ready.</p>}
      <button type="submit" className="button primary full-width" disabled={busy || !engine || !info || !status?.providers.fal || !!validationError || !selected.prompt.trim()}>
        {busy ? <span className="spinner" /> : action === 'Generate' ? <Clapperboard size={14} /> : <RotateCcw size={14} />} {busy ? 'Generating…' : action}
      </button>
      <p className="hint interstitial-action-hint">{retryLoading ? 'Retries loading the existing video without a new generation.' : status?.providers.fal ? 'Each generation uses fal.ai credits.' : 'Configure FAL_KEY to enable generation.'}</p>
    </form>
    {currentResult && <div className="interstitial-ready">
      <p>{currentResult.duration.toFixed(2)}s interstitial · ready in the timeline</p>
      {selected.previousResult && <p className="hint">Keeping the previous video until a replacement is ready.</p>}
      <div className="interstitial-ready-actions">
        <button className="button full-width" onClick={() => onPreview(selected)}>Play interstitial</button>
        {fullVideoUrl && <a className="button full-width" href={fullVideoUrl} download={downloadName}><Download size={14} /> Download full video</a>}
      </div>
      {fullVideoUrl && <p className="hint interstitial-download-hint">Includes the start and end reference footage · {currentResult.totalDuration.toFixed(2)}s total.</p>}
    </div>}
  </div>;
}
