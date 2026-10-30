import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Clapperboard, RotateCcw } from 'lucide-react';
import { COMFY, INTERSTITIAL, TIMELINE_FPS } from '../../../shared/constants';
import { comfyReferenceRange } from '../../../shared/comfy';
import type { AppStatus } from '../../../shared/contracts';
import { clipMaskInjection, minimumDuration, hasUnsubmittedChanges, isGenerating, normalizeGenerationMethod, playableResult, validateInterstitialDuration, type Interstitial } from '../../../shared/interstitials';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import type { InterstitialController } from './InterstitialController';
import { assets } from '../project/assets';
import { phaseLabel, renderingProgress } from './status';
import InterstitialTimeField from './InterstitialTimeField';
import InterstitialPreview from './InterstitialPreview';
import { referenceTiming } from '../call-response/generation';
import { enhancePrompt } from './enhance-prompt';
import EnhancePromptActions from './EnhancePromptActions';
import TaskStatus from '../../shared/TaskStatus';
import { sequenceActive } from '../call-response/sequence';
import MaskInjectionField from './MaskInjectionField';
import GenerationFeedback from './GenerationFeedback';

export type InterstitialEditorProps = {
  selected: Interstitial; controller: InterstitialController; engine: MediaEngine | null; info: MediaInfo | null;
  status: AppStatus | null; active: boolean; onPreviewPlay: () => void;
  resultDetails?: ReactNode;
  compact?: boolean; generationSettings?: ReactNode;
};
export default function InterstitialEditor({ selected, controller, engine, info, status, active, onPreviewPlay, resultDetails, compact = false, generationSettings }: InterstitialEditorProps) {
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
  const method = normalizeGenerationMethod(selected.method);
  const currentResult = playableResult(selected);
  const changed = hasUnsubmittedChanges(selected);
  const sequence = controller.getSnapshot().sequence;
  const sequenced = sequenceActive(sequence) && sequence!.ids.includes(selected.id);
  const currentRequest = controller.canRecover(selected.id);
  const retryLoading = !busy && !!selected.result && selected.phase !== 'ready' && currentRequest;
  const canCheck = !busy && selected.phase === 'error' && !!selected.requestId && !selected.result;
  const retryChecking = canCheck && currentRequest;
  const recovering = retryLoading || retryChecking;
  const canRecover = !!selected.result?.assetId || !!status?.providers.comfy;
  const action = retryLoading ? 'Retry loading' : retryChecking ? 'Check result' : selected.phase === 'error' || selected.phase === 'cancelled' ? 'Retry' : currentResult ? 'Regenerate' : 'Generate';
  const fullVideoUrl = currentResult?.fullAssetId ? assets.url(currentResult.fullAssetId) : currentResult?.assetId ? assets.url(currentResult.assetId) : undefined;
  const trimmedLoop = (currentResult?.reference?.mode === 'loop' || !compact && (kind === 'idle' || method === 'comfy-loop')) && !currentResult?.fullAssetId;
  const downloadName = `${selected.label.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'interstitial'}-${trimmedLoop ? 'loop' : 'full'}.mp4`;
  let validationError = '';
  let comfyPlan: ReturnType<typeof comfyReferenceRange>['plan'] | undefined;
  try {
    validateInterstitialDuration(selected.duration, compact ? 'comfy-loop' : method);
    if (selected.prompt.length > 8000) throw new Error('Shorten the prompt to fit this model.');
    if (info && !dependency?.blocked) {
      const timing = dependency?.reference && referenceTiming(selected, dependency.reference);
      const input = timing ? { ...selected, time: timing.time } : selected;
      const duration = timing?.duration || info.duration;
      comfyPlan = comfyReferenceRange(input, duration).plan;
    }
  } catch (error) { validationError = (error as Error).message; }
  const canGenerate = !!engine && !!info && !!status?.providers.comfy && !validationError && !dependency?.blocked && !!selected.prompt.trim();
  const referenceDescription = dependency ? dependency.reference?.before && dependency.reference?.after
    ? `Uses the connected input’s ending and output’s beginning.`
    : dependency.reference?.before ? `Uses the ending of ${dependency.label}.`
    : dependency.reference?.after ? `Uses the beginning of ${dependency.label}.` : 'Generates from the prompt without reference footage.' : '';
  const message = selected.error || validationError || dependency?.blocked || (status && !status.providers.comfy ? 'Comfy Cloud is not connected.' : '')
    || (busy ? phaseLabel(selected) : enhancing ? 'Enhancing prompt…' : enhancementError)
    || (dependency?.stale ? 'References changed · regenerate to match' : '')
    || (sequenced ? 'Waiting in sequence' : selected.phase === 'cancelled' ? 'Cancelled' : !selected.prompt.trim() ? 'Add a prompt to generate' : changed ? 'Settings edited · ready to regenerate' : currentResult ? 'Video ready' : 'Ready to generate');
  const messages = [...new Set([message, referenceDescription, dependency?.stale && 'The saved video uses different references. Regenerate to match the current connections.',
    dependency?.blocked, selected.error, validationError, enhancementError,
    busy && changed && 'This render uses the submitted settings. Your edits apply to the next generation.'].filter((value): value is string => !!value))];
  const progress = selected.phase === 'rendering' ? renderingProgress(selected) : selected.progress;
  const timeFields = <>
    {(!compact || selected.useInputReference) && <InterstitialTimeField name="start_range" label={compact ? 'Input footage' : method === 'comfy-extend' || method === 'comfy-loop' ? 'Reference tail' : 'Start range'} value={selected.start_range} min={INTERSTITIAL.minStartRange} max={INTERSTITIAL.maxRange} step={0.025} onChange={value => controller.edit(selected.id, { start_range: value })} />}
    {method !== 'comfy-extend' && <InterstitialTimeField name="end_range" label={compact ? 'Output footage' : method === 'comfy-loop' ? 'Loop end reference' : 'End range'} value={selected.end_range} min={COMFY.minContextFrames / TIMELINE_FPS} max={INTERSTITIAL.maxRange} step={0.1} onChange={value => controller.edit(selected.id, { end_range: value })} />}
  </>;
  const durationField = <InterstitialTimeField name="Duration" label={method === 'comfy-loop' ? 'Loop duration' : 'Duration'} value={selected.duration} min={minimumDuration(compact ? 'comfy-loop' : method)} max={INTERSTITIAL.maxDuration} step={0.25} onChange={value => controller.edit(selected.id, { duration: value })} />;
  const submittedPrompt=currentResult?.prompt??(selected.phase==='ready'?selected.requestPrompt:undefined);
  const promptDetails = <details className="interstitial-prompt-details">
    <summary>Submitted prompt</summary>
    {submittedPrompt?<pre>{submittedPrompt}</pre>:<p>The prompt was not saved with this older video.</p>}
    <p>Prompt instructions apply to the generated section. Reference footage keeps its original video and audio.</p>
  </details>;
  const advanced = <>
    <MaskInjectionField key={`mask:${selected.id}`} value={clipMaskInjection(selected)} hasEndReference={method !== 'comfy-extend' && selected.useInputReference !== false}
      onChange={maskInjection => controller.edit(selected.id, { maskInjection })} />
    {kind === 'idle' && <label className="interstitial-option"><input type="checkbox" checked={!!selected.loopAudio}
      disabled={!!currentResult && !currentResult.fullAssetId && currentResult.reference?.mode === 'loop'}
      onChange={event => controller.edit(selected.id, { loopAudio: event.target.checked })} /> Play generated clip audio</label>}
    {kind === 'idle' && currentResult && !currentResult.fullAssetId && currentResult.reference?.mode === 'loop' && <p className="hint">Regenerate the loop to make its audio available.</p>}
    {controller.hasLinkedDuration(selected.id) && <p className="hint">Shared duration for all response branches. Changes apply to their next generation.</p>}
    {comfyPlan && <p className="hint">{comfyPlan.insertion.duration.toFixed(3)}s generated · {(comfyPlan.prefixFrames / TIMELINE_FPS).toFixed(3)}s / {(comfyPlan.suffixFrames / TIMELINE_FPS).toFixed(3)}s reference footage</p>}
  </>;
  const output = <>{resultDetails}{currentResult&&promptDetails}{fullVideoUrl && <InterstitialPreview url={fullVideoUrl} label={selected.label} downloadName={downloadName}
    heading={currentResult?.fullAssetId ? 'Full generated video, including references' : trimmedLoop ? 'Loop video' : 'Generated video'}
    active={active} muted={(kind === 'idle' || method === 'comfy-loop') && !selected.loopAudio} onPlay={onPreviewPlay} />}</>;
  const form = <form onSubmit={event => { event.preventDefault(); if (enhancing || sequenced) return; if (recovering) void controller.resume(selected.id); else if (engine && info) void controller.generate(selected.id, engine, info); }}>
    <fieldset>
      {!compact && <p className="hint">Comfy Cloud · {method === 'comfy-extend' ? 'H3 extension' : method === 'comfy-loop' ? 'H3 loop' : 'H3 bridge'}</p>}
      {generationSettings}
      <div className="field inspector-prompt">
        <div className="prompt-field-heading">
          <label htmlFor={promptId}>Prompt</label>
          {changed && <span className="interstitial-edited" title="Changes apply to the next generation">Edited</span>}
          <EnhancePromptActions promptId={promptId} enhancing={enhancing} enabled={!!selected.prompt.trim()} connected={!!status?.providers.openai}
            onEnhance={() => void enhance()} onCancel={() => { enhancement.current?.abort(); enhancement.current = null; setEnhancing(false); }} />
        </div>
        <textarea id={promptId} aria-label="Interstitial prompt" rows={compact ? 3 : 4} required maxLength={8000} placeholder="Describe the action, camera, sound…" value={selected.prompt} onChange={event => controller.edit(selected.id, { prompt: event.target.value })} />
        {!compact && (selected.continuity?.trim() || selected.dialogue?.trim()) && <p className="hint">Enhance this clip to include the shared brief and any saved dialogue. Generation sends only the prompt above.</p>}
      </div>
      {!compact && <><div className="interstitial-enhancement-feedback">{enhancementError && <p className="inline-error" role="alert">{enhancementError}</p>}</div></>}
      <div className="interstitial-time-fields" key={selected.id}>{!compact && timeFields}{durationField}</div>
      {!compact && advanced}
    </fieldset>
    {!compact && <div className="interstitial-generation-feedback" aria-live="polite">
      {validationError && <p className="inline-error" role="alert">{validationError}</p>}
      {selected.error && <p className="inline-error" role="alert">{selected.error}</p>}
      {busy && changed && <p className="hint">This render uses the submitted settings. Your edits are saved for the next generation.</p>}
      {sequenced && !busy && <p className="hint">{sequence!.completedIds.includes(selected.id) ? 'Generated in this sequence. New edits apply to the next generation.' : 'Waiting in sequence. Your edits will be used when this clip starts.'}</p>}
      {selected.phase === 'cancelled' && <p className="hint">Cancelled</p>}
    </div>}
    <div className={compact ? 'inspector-generate-actions' : undefined}>
      <button type="submit" className="button primary full-width" disabled={busy || sequenced || enhancing || (recovering ? !canRecover : !canGenerate)}>
        <span className="status-icon">{busy ? <span className="spinner" /> : action === 'Generate' ? <Clapperboard size={14} /> : <RotateCcw size={14} />}</span> {busy ? 'Generating…' : action}
      </button>
      <div className="interstitial-recovery-slot">{canCheck && <button type="button" className="button full-width" disabled={sequenced || enhancing || (retryChecking ? !canGenerate : !canRecover)} onClick={() => {
        if (retryChecking && engine && info) void controller.generate(selected.id, engine, info);
        else if (!retryChecking) void controller.resume(selected.id);
      }}>{retryChecking ? 'Regenerate' : 'Check result'}</button>}</div>
    </div>
    {compact && <GenerationFeedback busy={busy} message={message} messages={messages} error={!!(selected.error || validationError || enhancementError || dependency?.blocked)} progress={progress} onCancel={() => void controller.cancel(selected.id)} />}
    {!compact && status && !status.providers.comfy && <p className="hint interstitial-action-hint">Comfy Cloud is not connected.</p>}
    {compact && <details className="inspector-group inspector-advanced"><summary>Advanced<span>Mask & audio</span></summary><div className="inspector-group-body">
      {advanced}
    </div></details>}
  </form>;
  return <div className={`interstitial-editor${compact ? ' interstitial-editor-compact' : ''}`} data-project-edit>
    {compact ? <details className="inspector-group inspector-generation" open><summary>Generation<span>Comfy · H3</span></summary>{form}</details> : <>
      <div className="interstitial-reference-feedback"><p className="hint clip-dependency">{referenceDescription}</p>
        {dependency?.stale && <p className="clip-stale" role="status">Stale: upstream video changed. Regenerate this clip to match.</p>}
        {dependency?.blocked && <p className="hint">{dependency.blocked}</p>}
      </div>{form}
      <TaskStatus active={busy} message={phaseLabel(selected)} cancelLabel="Cancel interstitial generation" onCancel={() => void controller.cancel(selected.id)}
        progress={busy ? { label: selected.phase === 'preparing' ? 'Preparing reference' : selected.phase === 'loading' ? 'Loading generated video' : 'Generating interstitial', value: progress } : undefined} />
    </>}
    {compact ? <details className="inspector-group inspector-output"><summary>Generated video<span>{currentResult ? `${(currentResult.fullRange?.totalDuration ?? currentResult.totalDuration).toFixed(2)} s` : 'Not generated'}</span></summary>
      <div className="inspector-group-body">{currentResult ? output : <p className="hint">Generate this clip to see its video and reference breakdown.</p>}</div>
    </details> : output}
  </div>;
}
