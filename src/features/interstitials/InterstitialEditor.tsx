import { useEffect, useId, useRef, useState } from 'react';
import { Clapperboard, RotateCcw, Sparkles, X } from 'lucide-react';
import { COMFY, INTERSTITIAL, TIMELINE_FPS } from '../../../shared/constants';
import { comfyReferenceRange } from '../../../shared/comfy';
import type { AppStatus } from '../../../shared/contracts';
import { generationPrompt, generationProvider, minimumDuration, hasUnsubmittedChanges, isGenerating, playableResult, referenceRange, validateInterstitialDuration, type Interstitial, type GenerationMethod } from '../../../shared/interstitials';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import type { InterstitialController } from './InterstitialController';
import { assets } from '../project/assets';
import { phaseLabel, renderingProgress } from './status';
import InterstitialTimeField from './InterstitialTimeField';
import InterstitialPreview from './InterstitialPreview';
import { referenceTiming } from '../call-response/generation';
import { enhancePrompt } from './enhance-prompt';
import TaskStatus from '../../shared/TaskStatus';
import { sequenceActive } from '../call-response/sequence';

export type InterstitialEditorProps = {
  selected: Interstitial; controller: InterstitialController; engine: MediaEngine | null; info: MediaInfo | null;
  status: AppStatus | null; active: boolean; onPreviewPlay: () => void;
};
export default function InterstitialEditor({ selected, controller, engine, info, status, active, onPreviewPlay }: InterstitialEditorProps) {
  const promptId = useId();
  const dependency = controller.dependency(selected.id);
  const kind = controller.clipKind(selected.id);
  const [enhancing, setEnhancing] = useState(false);
  const [enhancementError, setEnhancementError] = useState('');
  const enhancement = useRef<AbortController | null>(null);
  const referenceKey = JSON.stringify(dependency?.reference);
  useEffect(() => {
    setEnhancing(false); setEnhancementError('');
    return () => { enhancement.current?.abort(); enhancement.current = null; };
  }, [controller, engine, selected.id, selected.prompt, selected.continuity, selected.dialogue, selected.duration, selected.time, kind, referenceKey]);
  const enhance = async () => {
    if (enhancement.current || !status?.providers.openai || !selected.prompt.trim()) return;
    const operation = new AbortController(); enhancement.current = operation;
    setEnhancing(true); setEnhancementError('');
    try {
      const result = await enhancePrompt(selected, kind, dependency?.reference, engine, info, operation.signal);
      if (!operation.signal.aborted && enhancement.current === operation && controller.getSnapshot().items.find(item => item.id === selected.id)?.prompt === selected.prompt) {
        controller.edit(selected.id, { prompt: result.prompt });
      }
    } catch (error) {
      if (!operation.signal.aborted && enhancement.current === operation) setEnhancementError(error instanceof Error ? error.message : 'Prompt enhancement failed. Try again.');
    } finally {
      if (enhancement.current === operation) { enhancement.current = null; setEnhancing(false); }
    }
  };
  const busy = isGenerating(selected);
  const method = selected.method ?? 'fal';
  const currentResult = playableResult(selected);
  const changed = hasUnsubmittedChanges(selected);
  const sequence = controller.getSnapshot().sequence;
  const sequenced = sequenceActive(sequence) && sequence!.ids.includes(selected.id);
  const currentRequest = controller.canRecover(selected.id);
  const retryLoading = !busy && !!selected.result && selected.phase !== 'ready' && currentRequest;
  const canCheck = !busy && selected.phase === 'error' && !!selected.requestId && !selected.result;
  const retryChecking = canCheck && currentRequest;
  const recovering = retryLoading || retryChecking;
  const requestMethod = selected.requestMethod ?? selected.generationSettings?.method ?? method;
  const canRecover = !!selected.result?.assetId || !!status?.providers[generationProvider(requestMethod)];
  const action = retryLoading ? 'Retry loading' : retryChecking ? 'Check result' : selected.phase === 'error' || selected.phase === 'cancelled' ? 'Retry' : currentResult ? 'Regenerate' : 'Generate';
  const fullVideoUrl = currentResult?.assetId ? assets.url(currentResult.assetId) : undefined;
  const downloadName = `${selected.label.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'interstitial'}-full.mp4`;
  let validationError = '';
  let comfyPlan: ReturnType<typeof comfyReferenceRange>['plan'] | undefined;
  try {
    validateInterstitialDuration(selected.duration, method);
    if (generationPrompt(selected).length > (generationProvider(method) === 'comfy' ? 8000 : 4000)) throw new Error('Shorten the combined continuity brief and prompt to fit this model.');
    if (info && !dependency?.blocked) {
      const timing = dependency?.reference && referenceTiming(selected, dependency.reference);
      const input = timing ? { ...selected, time: timing.time } : selected;
      const duration = timing ? timing.duration : info.duration;
      if (generationProvider(method) === 'comfy') comfyPlan = comfyReferenceRange(input, duration).plan;
      else referenceRange(input, duration);
    }
  } catch (error) { validationError = (error as Error).message; }
  const canGenerate = !!engine && !!info && !!status?.providers[generationProvider(method)] && !validationError && !dependency?.blocked && !!selected.prompt.trim();
  return <div className="interstitial-editor" data-project-edit>
    {dependency && <p className="hint clip-dependency">{method === 'comfy-extend' ? `Extends ${dependency.label} from its ending.`
      : method === 'comfy-loop' ? `Uses ${dependency.label}'s ending for both loop boundaries.`
      : dependency.reference?.after ? `Bridges from ${dependency.label} back into the parent video after the pin.` : `Uses ${dependency.label} as its reference.`}</p>}
    {dependency?.stale && <p className="clip-stale" role="status">Stale: upstream video changed. Regenerate this clip to match.</p>}
    {dependency?.blocked && <p className="hint">{dependency.blocked}</p>}
    <form onSubmit={event => { event.preventDefault(); if (enhancing || sequenced) return; if (recovering) void controller.resume(selected.id); else if (engine && info) void controller.generate(selected.id, engine, info); }}>
      <fieldset>
        <label className="field">Generate with<select aria-label="Video generation method" value={method} onChange={event => controller.edit(selected.id, { method: event.target.value as GenerationMethod })}>
          <option value="comfy">Comfy Cloud · H3 bridge</option>
          <option value="comfy-extend">Comfy Cloud · H3 extension</option><option value="comfy-loop">Comfy Cloud · H3 loop</option>
          {!dependency && <option value="fal">Fal · H3 Max bridge</option>}
          {dependency && method === 'fal' && <option value="fal">Saved Fal method</option>}
        </select></label>
        <div className="field">
          <div className="prompt-field-heading">
            <label htmlFor={promptId}>Prompt</label>
            {changed && <span className="interstitial-edited" title="Changes apply to the next generation">Edited</span>}
            <div className="enhance-prompt-actions">
              <button type="button" className="text-button enhance-prompt" disabled={enhancing || !status?.providers.openai || !selected.prompt.trim()} aria-busy={enhancing}
                title={status?.providers.openai ? 'Enhance with OpenAI using reference frames to preserve the shot, composition and continuous positions' : 'Connect OpenAI to enhance prompts'} onClick={() => void enhance()}>
                {enhancing ? <span className="spinner" /> : <Sparkles size={12} />}
                <span className="button-labels"><span aria-hidden={enhancing}>Enhance prompt</span><span aria-hidden={!enhancing}>Enhancing…</span></span>
              </button>
              <button type="button" className="icon-button small enhance-prompt-cancel" aria-label="Cancel prompt enhancement" aria-hidden={!enhancing} disabled={!enhancing}
                onClick={() => { enhancement.current?.abort(); enhancement.current = null; setEnhancing(false); }}><X size={13} /></button>
            </div>
          </div>
          <textarea id={promptId} aria-label="Interstitial prompt" rows={4} required maxLength={generationProvider(method) === 'comfy' ? 8000 : 4000} placeholder="Describe the action, camera, sound and any spoken words…" value={selected.prompt} onChange={event => controller.edit(selected.id, { prompt: event.target.value })} />
        </div>
        {enhancementError && <p className="inline-error" role="alert">{enhancementError}</p>}
        <div className="interstitial-time-fields" key={selected.id}>
          <InterstitialTimeField name="start_range" label={method === 'comfy-extend' || method === 'comfy-loop' ? 'Reference tail' : 'Start range'} value={selected.start_range} min={INTERSTITIAL.minStartRange} max={INTERSTITIAL.maxRange} step={0.025} onChange={value => controller.edit(selected.id, { start_range: value })} />
          {method !== 'comfy-extend' && <InterstitialTimeField name="end_range" label={method === 'comfy-loop' ? 'Loop end reference' : 'End range'} value={selected.end_range} min={generationProvider(method) === 'comfy' ? COMFY.minContextFrames / TIMELINE_FPS : INTERSTITIAL.minEndRange} max={INTERSTITIAL.maxRange} step={0.1} onChange={value => controller.edit(selected.id, { end_range: value })} />}
          <InterstitialTimeField name="Duration" label={method === 'comfy-loop' ? 'Loop duration' : 'Duration'} value={selected.duration} min={minimumDuration(method)} max={INTERSTITIAL.maxDuration} step={0.25} onChange={value => controller.edit(selected.id, { duration: value })} />
        </div>
        {method === 'comfy-loop' && <><p className="hint">Both visible boundaries use the Call ending.</p>
          <label className="interstitial-option"><input type="checkbox" checked={selected.loopAudio ?? false} onChange={event => controller.edit(selected.id, { loopAudio: event.target.checked })} /> Include generated loop audio</label></>}
        {controller.hasLinkedDuration(selected.id) && <p className="hint">Shared duration for all response branches. Changes apply to their next generation.</p>}
        {comfyPlan && <p className="hint">{comfyPlan.insertion.duration.toFixed(3)}s generated · {(comfyPlan.prefixFrames / TIMELINE_FPS).toFixed(3)}s / {(comfyPlan.suffixFrames / TIMELINE_FPS).toFixed(3)}s context</p>}
        {method === 'fal' && <label className="interstitial-option"><input type="checkbox" checked={selected.enable_prompt_expansion}
          onChange={event => controller.edit(selected.id, { enable_prompt_expansion: event.target.checked })} /> Prompt expansion</label>}
      </fieldset>
      {validationError && <p className="inline-error" role="alert">{validationError}</p>}
      {selected.error && <p className="inline-error" role="alert">{selected.error}</p>}
      {busy && changed && <p className="hint">This render uses the submitted settings. Your edits are saved for the next generation.</p>}
      {sequenced && !busy && <p className="hint">{sequence!.completedIds.includes(selected.id) ? 'Generated in this sequence. New edits apply to the next generation.' : 'Waiting in sequence. Your edits will be used when this clip starts.'}</p>}
      {selected.phase === 'cancelled' && <p className="hint">Cancelled</p>}
      <button type="submit" className="button primary full-width" disabled={busy || sequenced || enhancing || (recovering ? !canRecover : !canGenerate)}>
        <span className="status-icon">{busy ? <span className="spinner" /> : action === 'Generate' ? <Clapperboard size={14} /> : <RotateCcw size={14} />}</span> {busy ? 'Generating…' : action}
      </button>
      {canCheck && <button type="button" className="button full-width" disabled={sequenced || enhancing || (retryChecking ? !canGenerate : !canRecover)} onClick={() => {
        if (retryChecking && engine && info) void controller.generate(selected.id, engine, info);
        else if (!retryChecking) void controller.resume(selected.id);
      }}>{retryChecking ? 'Regenerate' : 'Check result'}</button>}
      {status && !status.providers[generationProvider(method)] && <p className="hint interstitial-action-hint">{generationProvider(method) === 'comfy' ? 'Comfy Cloud' : 'fal.ai'} is not connected.</p>}
    </form>
    <TaskStatus active={busy} message={phaseLabel(selected)} cancelLabel="Cancel interstitial generation" onCancel={() => void controller.cancel(selected.id)}
      progress={selected.phase === 'preparing' ? { label: 'Preparing reference', value: selected.progress || 0 }
        : selected.phase === 'rendering' ? { label: 'Generating interstitial', value: renderingProgress(selected), title: generationProvider(requestMethod) === 'comfy' ? 'Estimated render progress: preparation 5%, sampler 90%, decoding and saving 5%.' : 'Generation progress reported by the provider' }
        : selected.phase === 'loading' ? { label: selected.progressDetails?.stage || 'Loading generated video', value: selected.progress } : undefined} />
    {fullVideoUrl && <InterstitialPreview url={fullVideoUrl} label={selected.label} downloadName={downloadName} active={active} onPlay={onPreviewPlay} />}
  </div>;
}
