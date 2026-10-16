import './styles.css';
import { useRef } from 'react';
import { ArrowLeft, Clapperboard, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { INTERSTITIAL } from '../../../shared/constants';
import { formatTime, type AppStatus } from '../../../shared/contracts';
import { hasUnsubmittedChanges, isGenerating, playableResult, referenceRange, validateInterstitialDuration, type Interstitial } from '../../../shared/interstitials';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import type { InterstitialController } from './InterstitialController';
import { assets } from '../project/assets';
import { phaseLabel } from './status';
import InterstitialTimeField from './InterstitialTimeField';
import InterstitialPreview from './InterstitialPreview';

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

export default function InterstitialPanel({ items, selectedId, controller, engine, info, status, active, onAdd, onSelect, onPreviewPlay }: {
  items: Interstitial[]; selectedId: string | null; controller: InterstitialController; engine: MediaEngine | null; info: MediaInfo | null; status: AppStatus | null;
  active: boolean; onAdd: () => void; onSelect: (id: string | null) => void; onPreviewPlay: () => void;
}) {
  const selected = items.find(item => item.id === selectedId);
  if (!selected) return <div className="panel-content interstitial-panel">
    <div className="panel-intro"><h2>Interstitials</h2></div>
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
  let validationError = '';
  try {
    validateInterstitialDuration(selected.duration);
    if (info) referenceRange(selected, info.duration);
  } catch (error) { validationError = (error as Error).message; }
  return <div className="panel-content interstitial-panel">
    <button className="text-button interstitial-back" onClick={() => onSelect(null)}><ArrowLeft size={13} /> All interstitials</button>
    <div className="interstitial-title"><h2>{selected.label}</h2><RemoveInterstitialButton item={selected} controller={controller} /></div>
    {busy && <div className="task-status" role="status"><span className="spinner" /><span>{phaseLabel(selected)}</span><button className="text-button" aria-label="Cancel interstitial generation" onClick={() => void controller.cancel(selected.id)}>Cancel</button></div>}
    {selected.phase === 'preparing' && <progress className="interstitial-progress" aria-label="Preparing reference" max="1" value={selected.progress || 0} />}
    <form onSubmit={event => { event.preventDefault(); if (engine && info) void controller.generate(selected.id, engine, info); }}>
      <fieldset>
        <label className="field">Prompt{changed && <span className="interstitial-edited" title="Changes apply to the next generation">Edited</span>}<textarea aria-label="Interstitial prompt" rows={4} required maxLength={4000} placeholder="Describe the scene to insert…" value={selected.prompt} onChange={event => controller.edit(selected.id, { prompt: event.target.value })} /></label>
        <div className="interstitial-time-fields" key={selected.id}>
          <InterstitialTimeField name="start_range" label="Start range" value={selected.start_range} min={INTERSTITIAL.minStartRange} max={INTERSTITIAL.maxRange} step={0.025} onChange={value => controller.edit(selected.id, { start_range: value })} />
          <InterstitialTimeField name="end_range" label="End range" value={selected.end_range} min={INTERSTITIAL.minEndRange} max={INTERSTITIAL.maxRange} step={0.1} onChange={value => controller.edit(selected.id, { end_range: value })} />
          <InterstitialTimeField name="Duration" label="Duration" value={selected.duration} min={INTERSTITIAL.minDuration} max={INTERSTITIAL.maxDuration} step={0.25} onChange={value => controller.edit(selected.id, { duration: value })} />
        </div>
        <label className="interstitial-option"><input type="checkbox" checked={selected.enable_prompt_expansion}
          onChange={event => controller.edit(selected.id, { enable_prompt_expansion: event.target.checked })} /> Prompt expansion</label>
      </fieldset>
      {validationError && <p className="inline-error" role="alert">{validationError}</p>}
      {selected.error && <p className="inline-error" role="alert">{selected.error}</p>}
      {selected.phase === 'cancelled' && <p className="hint">Cancelled</p>}
      <button type="submit" className="button primary full-width" disabled={busy || !engine || !info || !status?.providers.fal || !!validationError || !selected.prompt.trim()}>
        {busy ? <span className="spinner" /> : action === 'Generate' ? <Clapperboard size={14} /> : <RotateCcw size={14} />} {busy ? 'Generating…' : action}
      </button>
      {status && !status.providers.fal && <p className="hint interstitial-action-hint">fal.ai is not connected.</p>}
    </form>
    {fullVideoUrl && <InterstitialPreview url={fullVideoUrl} label={selected.label} downloadName={downloadName} active={active} onPlay={onPreviewPlay} />}
  </div>;
}
