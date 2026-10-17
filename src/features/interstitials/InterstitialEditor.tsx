import { Clapperboard, RotateCcw } from 'lucide-react';
import { COMFY, INTERSTITIAL, TIMELINE_FPS } from '../../../shared/constants';
import { comfyReferenceRange } from '../../../shared/comfy';
import type { AppStatus } from '../../../shared/contracts';
import { hasUnsubmittedChanges, isGenerating, playableResult, referenceRange, validateInterstitialDuration, type Interstitial } from '../../../shared/interstitials';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import type { InterstitialController } from './InterstitialController';
import { assets } from '../project/assets';
import { phaseLabel } from './status';
import InterstitialTimeField from './InterstitialTimeField';
import InterstitialPreview from './InterstitialPreview';
import { referenceTiming } from '../call-response/generation';

export type InterstitialEditorProps = {
  selected: Interstitial; controller: InterstitialController; engine: MediaEngine | null; info: MediaInfo | null;
  status: AppStatus | null; active: boolean; onPreviewPlay: () => void;
};
export default function InterstitialEditor({ selected, controller, engine, info, status, active, onPreviewPlay }: InterstitialEditorProps) {
  const dependency = controller.dependency(selected.id);
  const busy = isGenerating(selected);
  const method = selected.method ?? 'fal';
  const currentResult = playableResult(selected);
  const changed = hasUnsubmittedChanges(selected);
  const retryLoading = !busy && !!selected.result && selected.phase !== 'ready' && !changed;
  const action = retryLoading ? 'Retry loading' : selected.phase === 'error' || selected.phase === 'cancelled' ? 'Retry' : currentResult ? 'Regenerate' : 'Generate';
  const fullVideoUrl = currentResult?.assetId ? assets.url(currentResult.assetId) : undefined;
  const downloadName = `${selected.label.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'interstitial'}-full.mp4`;
  let validationError = '';
  let comfyPlan: ReturnType<typeof comfyReferenceRange>['plan'] | undefined;
  try {
    validateInterstitialDuration(selected.duration);
    if (info) {
      const timing = dependency?.reference && referenceTiming(selected, dependency.reference);
      const input = timing ? { ...selected, time: timing.time } : selected;
      const duration = timing ? timing.duration : info.duration;
      if (method === 'comfy') comfyPlan = comfyReferenceRange(input, duration).plan;
      else referenceRange(input, duration);
    }
  } catch (error) { validationError = (error as Error).message; }
  return <div className="interstitial-editor">
    {dependency && <p className="hint clip-dependency">Uses {dependency.label} as its reference.</p>}
    {dependency?.stale && <p className="clip-stale" role="status">Previous clip updated. Regenerate this clip to match.</p>}
    {dependency?.blocked && <p className="hint">{dependency.blocked}</p>}
    {busy && <div className="task-status" role="status"><span className="spinner" /><span>{phaseLabel(selected)}</span><button className="text-button" aria-label="Cancel interstitial generation" onClick={() => void controller.cancel(selected.id)}>Cancel</button></div>}
    {selected.phase === 'preparing' && <progress className="interstitial-progress" aria-label="Preparing reference" max="1" value={selected.progress || 0} />}
    {selected.phase === 'rendering' && selected.progress !== undefined && <progress className="interstitial-progress" aria-label="Generating interstitial" max="1" value={selected.progress} />}
    <form onSubmit={event => { event.preventDefault(); if (engine && info) void controller.generate(selected.id, engine, info); }}>
      <fieldset>
        <label className="field">Generate with<select aria-label="Video generation method" value={method} onChange={event => controller.edit(selected.id, { method: event.target.value as 'fal' | 'comfy' })}>
          <option value="fal">Fal · H3 Max</option><option value="comfy">Comfy · H3 masked bridge</option>
        </select></label>
        <label className="field">Prompt{changed && <span className="interstitial-edited" title="Changes apply to the next generation">Edited</span>}<textarea aria-label="Interstitial prompt" rows={4} required maxLength={4000} placeholder="Describe the scene to insert…" value={selected.prompt} onChange={event => controller.edit(selected.id, { prompt: event.target.value })} /></label>
        <div className="interstitial-time-fields" key={selected.id}>
          <InterstitialTimeField name="start_range" label="Start range" value={selected.start_range} min={INTERSTITIAL.minStartRange} max={INTERSTITIAL.maxRange} step={0.025} onChange={value => controller.edit(selected.id, { start_range: value })} />
          <InterstitialTimeField name="end_range" label="End range" value={selected.end_range} min={method === 'comfy' ? COMFY.minContextFrames / TIMELINE_FPS : INTERSTITIAL.minEndRange} max={INTERSTITIAL.maxRange} step={0.1} onChange={value => controller.edit(selected.id, { end_range: value })} />
          <InterstitialTimeField name="Duration" label="Duration" value={selected.duration} min={INTERSTITIAL.minDuration} max={INTERSTITIAL.maxDuration} step={0.25} onChange={value => controller.edit(selected.id, { duration: value })} />
        </div>
        {controller.hasLinkedDuration(selected.id) && <p className="hint">Shared duration for both response branches. Changes apply to their next generation.</p>}
        {comfyPlan && <p className="hint">{comfyPlan.insertion.duration.toFixed(3)}s generated · {(comfyPlan.prefixFrames / TIMELINE_FPS).toFixed(3)}s / {(comfyPlan.suffixFrames / TIMELINE_FPS).toFixed(3)}s context</p>}
        {method === 'fal' && <label className="interstitial-option"><input type="checkbox" checked={selected.enable_prompt_expansion}
          onChange={event => controller.edit(selected.id, { enable_prompt_expansion: event.target.checked })} /> Prompt expansion</label>}
      </fieldset>
      {validationError && <p className="inline-error" role="alert">{validationError}</p>}
      {selected.error && <p className="inline-error" role="alert">{selected.error}</p>}
      {selected.phase === 'cancelled' && <p className="hint">Cancelled</p>}
      <button type="submit" className="button primary full-width" disabled={busy || !engine || !info || !status?.providers[method] || !!validationError || !!dependency?.blocked || !selected.prompt.trim()}>
        {busy ? <span className="spinner" /> : action === 'Generate' ? <Clapperboard size={14} /> : <RotateCcw size={14} />} {busy ? 'Generating…' : action}
      </button>
      {status && !status.providers[method] && <p className="hint interstitial-action-hint">{method === 'fal' ? 'fal.ai' : 'Comfy Cloud'} is not connected.</p>}
    </form>
    {fullVideoUrl && <InterstitialPreview url={fullVideoUrl} label={selected.label} downloadName={downloadName} active={active} onPlay={onPreviewPlay} />}
  </div>;
}
