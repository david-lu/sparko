import GenerationLora from '../project/GenerationLora';
import { H3_MODEL_ID } from '../../../shared/loras';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Clapperboard, RotateCcw } from 'lucide-react';
import { COMFY, INTERSTITIAL, MASK_TRANSITION, TIMELINE_FPS } from '../../../shared/constants';
import { comfyReferenceRange } from '../../../shared/comfy';
import type { AppStatus } from '../../../shared/contracts';
import { minimumDuration, hasUnsubmittedChanges, isGenerating, normalizeGenerationMethod, playableResult, validateInterstitialDuration, validateMaskTransitionMs, type Interstitial } from '../../../shared/interstitials';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import type { InterstitialController } from './InterstitialController';
import { assets } from '../project/assets';
import { assetVolume } from '../project/assetVolume';
import { useAssetAvailability } from '../project/useAssetAvailability';
import { phaseLabel, renderingProgress } from './status';
import InterstitialTimeField from './InterstitialTimeField';
import InterstitialPreview from './InterstitialPreview';
import { referenceTiming } from '../call-response/generation';
import { enhancePrompt } from './enhance-prompt';
import EnhancePromptActions from './EnhancePromptActions';
import TaskStatus from '../../shared/TaskStatus';
import { sequenceActive } from '../call-response/sequence';
import GenerationFeedback from './GenerationFeedback';
import ImageReferences from './ImageReferences';
import { hasNoVideoInput } from './api';
import MaskCurveEditor from './MaskCurveEditor';
import { maskCurveSchema } from '../../../shared/mask-curves';
import type { ProjectController } from '../project/ProjectController';
import { showErrorToast } from '../../shared/toasts';

export type InterstitialEditorProps = {
  selected: Interstitial; controller: InterstitialController; engine: MediaEngine | null; info: MediaInfo | null;
  status: AppStatus | null; active: boolean; onPreviewPlay: () => void;
  resultDetails?: ReactNode;
  compact?: boolean; generationSettings?: ReactNode;
  projects?: ProjectController;
};
export default function InterstitialEditor({ selected, controller, engine, info, status, active, onPreviewPlay, resultDetails, compact = false, generationSettings, projects }: InterstitialEditorProps) {
  const promptId = useId(), resolutionId = useId();
  const dependency = controller.dependency(selected.id);
  useAssetAvailability([dependency?.reference?.before?.assetId, dependency?.reference?.after?.assetId, ...(selected.imageReferences ?? []).map(ref => ref.assetId)]);
  const kind = controller.clipKind(selected.id);
  const [enhancing, setEnhancing] = useState(false);
  const [addingImages, setAddingImages] = useState(false);
  useEffect(() => { setAddingImages(false); }, [selected.id, controller]);
  const enhancement = useRef<AbortController | null>(null);
  const referenceKey = JSON.stringify(dependency?.reference);
  useEffect(() => {
    setEnhancing(false);
    return () => { enhancement.current?.abort(); enhancement.current = null; };
  }, [controller, engine, selected.id, selected.prompt, selected.continuity, selected.dialogue, selected.duration, selected.time, kind, referenceKey, selected.imageReferences, selected.startImageIndex, selected.endImageIndex]);
  const enhance = async () => {
    if (enhancement.current || !status?.providers.openai || !selected.prompt.trim()) return;
    const operation = new AbortController(); enhancement.current = operation;
    setEnhancing(true);
    try {
      const result = await enhancePrompt(selected, kind, dependency?.reference, engine, info, operation.signal);
      const current = controller.getSnapshot().items.find(item => item.id === selected.id);
      if (!operation.signal.aborted && enhancement.current === operation && current?.prompt === selected.prompt
        && JSON.stringify(current.imageReferences ?? []) === JSON.stringify(selected.imageReferences ?? [])) {
        controller.edit(selected.id, { prompt: result.prompt });
      }
    } catch (error) {
      if (!operation.signal.aborted && enhancement.current === operation) showErrorToast('Video prompt enhancement failed', error instanceof Error ? error.message : 'Try again.', selected.label);
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
  const downloadName = `${selected.label.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'video'}-${trimmedLoop ? 'loop' : 'full'}.mp4`;
  const downloadAsset = projects?.getSnapshot().project?.library?.find(asset => asset.assetId === currentResult?.assetId);
  let validationError = '';
  const noVideo = hasNoVideoInput(selected);
  const hasSource = !!engine && !!info || !!(dependency?.reference?.before || dependency?.reference?.after);
  let comfyPlan: ReturnType<typeof comfyReferenceRange>['plan'] | undefined;
  try {
    validateInterstitialDuration(selected.duration, compact ? 'comfy-loop' : method);
    validateMaskTransitionMs(selected.audioMaskTransitionMs ?? selected.maskTransitionMs ?? MASK_TRANSITION.defaultMs, 'Audio mask transition');
    validateMaskTransitionMs(selected.videoMaskTransitionMs ?? selected.maskTransitionMs ?? MASK_TRANSITION.defaultMs, 'Video mask transition');
    for (const curve of [selected.videoMaskCurve, selected.audioMaskCurve]) if (curve) maskCurveSchema.parse(curve);
    if (selected.prompt.length > 8000) throw new Error('Shorten the prompt to fit this model.');
    if ((hasSource || noVideo) && !dependency?.blocked) {
      const timing = dependency?.reference && referenceTiming(selected, dependency.reference);
      const input = timing ? { ...selected, time: timing.time } : selected;
      const duration = timing?.duration || info?.duration || selected.duration;
      comfyPlan = comfyReferenceRange(input, duration).plan;
    }
  } catch (error) { validationError = (error as Error).message; }
  const canGenerate = (hasSource || noVideo) && !!status?.providers.comfy && !validationError && !dependency?.blocked && !!selected.prompt.trim();
  const referenceDescription = dependency?.reference?.mode === 'loop'
    ? dependency.reference.before ? `Uses the ending of ${dependency.label} as the shared start and end pose.` : selected.startImageIndex !== undefined ? `Picture ${selected.startImageIndex + 1} guides both the first and last frames of this loop.` : 'Generates a loop from the prompt without endpoint references.'
    : dependency ? dependency.reference?.before && dependency.reference?.after
    ? `Uses the connected input’s ending and output’s beginning.`
    : dependency.reference?.before ? `Uses the ending of ${dependency.label}.`
    : dependency.reference?.after ? `Uses the beginning of ${dependency.label}.` : 'Generates from the prompt without reference footage.' : '';
  const message = selected.error || validationError || dependency?.blocked || (status && !status.providers.comfy ? 'Comfy Cloud is not connected.' : '')
    || (busy ? phaseLabel(selected) : enhancing ? 'Enhancing prompt…' : '')
    || (dependency?.stale ? 'References changed · regenerate to match' : '')
    || (sequenced ? 'Waiting in sequence' : selected.phase === 'cancelled' ? 'Cancelled' : !selected.prompt.trim() ? 'Add a prompt to generate' : changed ? 'Settings edited · ready to regenerate' : currentResult ? 'Video ready' : 'Ready to generate');
  const messages = [...new Set([message, referenceDescription, dependency?.stale && 'The saved video uses different references. Regenerate to match the current connections.',
    dependency?.blocked, ...(dependency?.issues ?? []).map(issue => issue.message), selected.error, validationError,
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
  const referenceSettings = <>
    {!noVideo && <>
    <MaskCurveEditor key={`curves:${selected.id}`} before={comfyPlan?comfyPlan.prefixFrames/TIMELINE_FPS:selected.useInputReference===false?0:selected.start_range}
      after={comfyPlan?comfyPlan.suffixFrames/TIMELINE_FPS:method==='comfy-extend'||selected.useOutputReference===false?0:selected.end_range}
      duration={comfyPlan?.insertion.duration??selected.duration} video={selected.videoMaskCurve} audio={selected.audioMaskCurve}
      videoMs={selected.videoMaskTransitionMs??selected.maskTransitionMs??MASK_TRANSITION.defaultMs}
      audioMs={selected.audioMaskTransitionMs??selected.maskTransitionMs??MASK_TRANSITION.defaultMs}
      onChange={patch=>controller.edit(selected.id,patch)}/>
    <details className="mask-simple-transitions"><summary>Simple transition durations</summary>
    <InterstitialTimeField name="Audio mask transition duration" label="Audio mask transition" unit="ms" value={selected.audioMaskTransitionMs ?? selected.maskTransitionMs ?? MASK_TRANSITION.defaultMs}
      min={0} max={MASK_TRANSITION.maxMs} step={50} onChange={audioMaskTransitionMs => controller.edit(selected.id, { audioMaskTransitionMs, audioMaskCurve: undefined })} />
    <InterstitialTimeField name="Video mask transition duration" label="Video mask transition" unit="ms" value={selected.videoMaskTransitionMs ?? selected.maskTransitionMs ?? MASK_TRANSITION.defaultMs}
      min={0} max={MASK_TRANSITION.maxMs} step={50} onChange={videoMaskTransitionMs => controller.edit(selected.id, { videoMaskTransitionMs, videoMaskCurve: undefined })} />
    <p className="hint">Changing a duration resets that mask to a simple ramp. Set it to 0 for a hard boundary.</p></details>
    </>}
    {kind === 'idle' && <label className="interstitial-option"><input type="checkbox" checked={!!selected.loopAudio}
      disabled={!!currentResult && !currentResult.fullAssetId && currentResult.reference?.mode === 'loop'}
      onChange={event => controller.edit(selected.id, { loopAudio: event.target.checked })} /> Play generated clip audio</label>}
    {kind === 'idle' && currentResult && !currentResult.fullAssetId && currentResult.reference?.mode === 'loop' && <p className="hint">Regenerate the loop to make its audio available.</p>}
    {controller.hasLinkedDuration(selected.id) && <p className="hint">Shared duration for all response branches. Changes apply to their next generation.</p>}
    <p className="hint reference-plan">{comfyPlan ? `${comfyPlan.insertion.duration.toFixed(3)}s generated · ${((comfyPlan.prefixFrames + comfyPlan.suffixFrames) / TIMELINE_FPS).toFixed(3)}s reference footage` : '\u00a0'}</p>
  </>;
  const output = <>{resultDetails}{currentResult&&promptDetails}{fullVideoUrl && <InterstitialPreview url={fullVideoUrl} label={selected.label} downloadName={downloadName}
    downloadAsset={downloadAsset && { ...downloadAsset, volume: assetVolume(projects?.getSnapshot().project?.library, downloadAsset.assetId), assetId: currentResult?.fullAssetId ?? downloadAsset.assetId }}
    heading={currentResult?.fullAssetId ? 'Full generated video, including references' : trimmedLoop ? 'Loop video' : 'Generated video'}
    active={active} muted={(kind === 'idle' || method === 'comfy-loop') && !selected.loopAudio} onPlay={onPreviewPlay} />}</>;
  const form = <form onSubmit={event => { event.preventDefault(); if (enhancing || sequenced || addingImages) return; if (recovering) void controller.resume(selected.id); else if (canGenerate) void controller.generate(selected.id, engine, info); }}>
    <fieldset>
      {!compact && <p className="hint">Comfy Cloud · {method === 'comfy-extend' ? 'H3 extension' : method === 'comfy-loop' ? 'H3 loop' : 'H3 bridge'}</p>}
      <GenerationLora key={`lora:${selected.id}`} model={H3_MODEL_ID} value={selected.lora} loras={projects?.getSnapshot().project?.loras} onChange={lora => controller.edit(selected.id, { lora })}/>
      <div className="field inspector-prompt">
        <div className="prompt-field-heading">
          <label htmlFor={promptId}>Prompt</label>
          {changed && <span className="interstitial-edited" title="Changes apply to the next generation">Edited</span>}
          <EnhancePromptActions promptId={promptId} enhancing={enhancing} enabled={!!selected.prompt.trim() && !addingImages} connected={!!status?.providers.openai}
            onEnhance={() => void enhance()} onCancel={() => { enhancement.current?.abort(); enhancement.current = null; setEnhancing(false); }} />
        </div>
        <textarea id={promptId} aria-label="Video prompt" rows={compact ? 3 : 4} required maxLength={8000} placeholder="Describe the action, camera, sound…" value={selected.prompt} onChange={event => controller.edit(selected.id, { prompt: event.target.value })} />
        {!compact && (selected.continuity?.trim() || selected.dialogue?.trim()) && <p className="hint">Enhance this clip to include the shared brief and any saved dialogue. Generation sends only the prompt above.</p>}
      </div>
      <details className="inspector-group inspector-references-panel" open><summary>References<span>Optional</span></summary><div className="inspector-group-body">
        {generationSettings}
        <ImageReferences key={`images:${selected.id}`} projects={projects} value={selected.imageReferences} onBusyChange={setAddingImages} onChange={imageReferences => {
          const saved = controller.getSnapshot().items.find(item => item.id === selected.id) ?? selected;
          const remap = (index: number | undefined) => {
            if (index === undefined) return undefined;
            const previous = saved.imageReferences?.[index];
            if (!previous) return index;
            const next = imageReferences.findIndex(image => image.assetId === previous.assetId);
            return next < 0 ? undefined : next;
          };
          const startImageIndex = remap(saved.startImageIndex), endImageIndex = remap(saved.endImageIndex);
          controller.edit(selected.id, { imageReferences, startImageIndex, endImageIndex,
            ...(saved.startImageIndex !== undefined && startImageIndex === undefined ? { startReferenceType: 'none' } : {}),
            ...(saved.endImageIndex !== undefined && endImageIndex === undefined ? { endReferenceType: 'none' } : {}) });
        }} />
        {referenceSettings}
      </div></details>
      <div className="field interstitial-resolution">
        <label className="interstitial-option" htmlFor={resolutionId}>
          <input id={resolutionId} type="checkbox" aria-label="Enable 2K regeneration" aria-describedby={`${resolutionId}-help`} checked={selected.resolution === '2k'}
            onChange={event=>controller.edit(selected.id,{resolution:event.target.checked?'2k':'native'})}/>
          Enable 2K regeneration (optional)
        </label>
        <p id={`${resolutionId}-help`} className="hint">Off by default: Native H3 output. Enable this to add the official H3-Regenerate-2K pass.</p>
      </div>
      <div className="interstitial-time-fields" key={selected.id}>{!compact && timeFields}{durationField}</div>
    </fieldset>
    {!compact && <div className="interstitial-generation-feedback" aria-live="polite">
      {validationError && <p className="inline-error" role="alert">{validationError}</p>}
      {selected.error && <p className="inline-error" role="alert">{selected.error}</p>}
      {busy && changed && <p className="hint">This render uses the submitted settings. Your edits are saved for the next generation.</p>}
      {sequenced && !busy && <p className="hint">{sequence!.completedIds.includes(selected.id) ? 'Generated in this sequence. New edits apply to the next generation.' : 'Waiting in sequence. Your edits will be used when this clip starts.'}</p>}
      {selected.phase === 'cancelled' && <p className="hint">Cancelled</p>}
    </div>}
    <div className={compact ? 'inspector-generate-actions' : undefined}>
      <button type="submit" className="button primary full-width" disabled={busy || sequenced || enhancing || addingImages || (recovering ? !canRecover : !canGenerate)}>
        <span className="status-icon">{busy ? <span className="spinner" /> : action === 'Generate' ? <Clapperboard size={14} /> : <RotateCcw size={14} />}</span> {busy ? 'Generating…' : action}
      </button>
      <div className="interstitial-recovery-slot">{canCheck && <button type="button" className="button full-width" disabled={sequenced || enhancing || addingImages || (retryChecking ? !canGenerate : !canRecover)} onClick={() => {
        if (retryChecking && canGenerate) void controller.generate(selected.id, engine, info);
        else if (!retryChecking) void controller.resume(selected.id);
      }}>{retryChecking ? 'Regenerate' : 'Check result'}</button>}</div>
    </div>
    {compact && <GenerationFeedback busy={busy} message={message} messages={messages} error={!!(selected.error || validationError || dependency?.blocked)} progress={progress} onCancel={() => void controller.cancel(selected.id)} />}
    {!compact && status && !status.providers.comfy && <p className="hint interstitial-action-hint">Comfy Cloud is not connected.</p>}
  </form>;
  return <div className={`interstitial-editor${compact ? ' interstitial-editor-compact' : ''}`} data-project-edit>
    {compact ? <details className="inspector-group inspector-generation" open><summary>Generation<span>Comfy · H3</span></summary>{form}</details> : <>
      <div className="interstitial-reference-feedback"><p className="hint clip-dependency">{referenceDescription}</p>
        {dependency?.stale && <p className="clip-stale" role="status">Stale: upstream video changed. Regenerate this clip to match.</p>}
        {dependency?.blocked && <p className="hint">{dependency.blocked}</p>}
      </div>{form}
      <TaskStatus active={busy} message={phaseLabel(selected)} cancelLabel="Cancel video generation" onCancel={() => void controller.cancel(selected.id)}
        progress={busy ? { label: selected.phase === 'preparing' ? 'Preparing reference' : selected.phase === 'loading' ? 'Loading generated video' : 'Generating video', value: progress } : undefined} />
    </>}
    {compact ? <details className="inspector-group inspector-output"><summary>Generated video<span>{currentResult ? `${(currentResult.fullRange?.totalDuration ?? currentResult.totalDuration).toFixed(2)} s` : 'Not generated'}</span></summary>
      <div className="inspector-group-body">{currentResult ? output : <p className="hint">Generate this clip to see its video and reference breakdown.</p>}</div>
    </details> : output}
  </div>;
}
