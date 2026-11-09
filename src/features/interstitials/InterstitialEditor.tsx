import { generationPrompt, promptSelectionError, promptEnhancementPatch } from '../../../shared/prompt-versions';
import EnhancedPromptField from './EnhancedPromptField';
import { enabledImageReferences } from '../../../shared/image-references';
import { validateTimelineVideos } from '../../../shared/video-references';
import GenerationTimelineEditor from './GenerationTimelineEditor';
import { activeVideoKeyframes, validateVideoKeyframes } from '../../../shared/video-keyframes';
import GenerationLora from '../project/GenerationLora';
import { H3_MODEL_ID, generationLoraInstructions } from '../../../shared/loras';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Clapperboard, RotateCcw } from 'lucide-react';
import { H3_PROMPT_MAX_LENGTH, MASK_TRANSITION } from '../../../shared/constants';
import { normalizeH3Prompt, validateH3PromptLength } from '../../../shared/h3-prompt';
import { comfyReferenceRange } from '../../../shared/comfy';
import type { AppStatus } from '../../../shared/contracts';
import { hasUnsubmittedChanges, isGenerating, minimumDuration, normalizeGenerationMethod, playableResult, validateInterstitialDuration, validateMaskTransitionMs, type Interstitial } from '../../../shared/interstitials';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import type { InterstitialController } from './InterstitialController';
import { assets } from '../project/assets';
import { useAssetAvailability } from '../project/useAssetAvailability';
import { phaseLabel, renderingProgress } from './status';
import InterstitialOutput from './InterstitialOutput';
import { referenceTiming } from '../call-response/generation';
import { enhancePrompt } from './enhance-prompt';
import EnhancePromptActions, { type PromptEditResult } from './EnhancePromptActions';
import TaskStatus from '../../shared/TaskStatus';
import { sequenceActive } from '../call-response/sequence';
import GenerationFeedback from './GenerationFeedback';
import GenerationSeed from './GenerationSeed';
import { hasNoVideoInput } from './api';
import { maskCurveSchema } from '../../../shared/mask-curves';
import type { ProjectController } from '../project/ProjectController';
import { showErrorToast } from '../../shared/toasts';
import type { PromptFramePlayer } from '../player/promptFrame';
import { useGenerationWorkspace } from './GenerationWorkspace';

export type InterstitialEditorProps = {
  selected: Interstitial; controller: InterstitialController; engine: MediaEngine | null; info: MediaInfo | null;
  status: AppStatus | null; active: boolean; onPreviewPlay: () => void;
  resultDetails?: ReactNode;
  compact?: boolean;
  showOutput?: boolean;
  projects?: ProjectController;
  player?: PromptFramePlayer;
};
export default function InterstitialEditor({ selected, controller, engine, info, status, active, onPreviewPlay, resultDetails, compact = false, showOutput = true, projects, player }: InterstitialEditorProps) {
  const workspace = useGenerationWorkspace();
  const promptId = useId(), resolutionId = useId(), analysisId = useId();
  const dependency = controller.dependency(selected.id);
  useAssetAvailability([dependency?.reference?.before?.assetId, dependency?.reference?.after?.assetId, ...(selected.imageReferences ?? []).map(ref => ref.assetId), ...(selected.timelineVideos ?? []).flatMap(v => v.video ? [v.video.assetId] : []), ...(selected.keyframes ?? []).flatMap(k => k.image ? [k.image.assetId] : [])]);
  const kind = controller.clipKind(selected.id);
  const loraInstructions = generationLoraInstructions(selected, projects?.getSnapshot().project?.loras, H3_MODEL_ID);
  const [enhancing, setEnhancing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [addingImages, setAddingImages] = useState(false);
  useEffect(() => { setAddingImages(false); }, [selected.id, controller]);
  const enhancement = useRef<AbortController | null>(null);
  const referenceKey = JSON.stringify(dependency?.reference);
  useEffect(() => {
    setEnhancing(false); setAnalyzing(false);
    return () => { enhancement.current?.abort(); enhancement.current = null; };
  }, [controller, engine, info?.duration, selected.id, selected.prompt, selected.enhancedPrompt, selected.enhancedPromptStale, selected.useEnhancedPrompt, selected.continuity, selected.dialogue, selected.duration, selected.time, selected.start_range, selected.end_range, selected.method, selected.resolution, selected.useInputReference, selected.useOutputReference, selected.analyzeReferences, selected.audioMaskCurve, selected.audioMaskTransitionMs, selected.maskTransitionMs, kind, referenceKey, selected.imageReferences, selected.keyframes, selected.startImageIndex, selected.endImageIndex, selected.lora, loraInstructions]);
  const enhance = async (editInstructions?: string): Promise<PromptEditResult> => {
    if (enhancement.current || !status?.providers.openai || !selected.prompt.trim()) return { applied: false };
    const operation = new AbortController(); enhancement.current = operation;
    setEnhancing(true);
    try {
      const result = await enhancePrompt({ ...selected, loraInstructions }, kind, dependency?.reference, engine, info, operation.signal, { player, captureFrame: workspace?.getFrameCapture(), editInstructions,
        onAnalyzing: value => { if (enhancement.current === operation) setAnalyzing(value); } });
      const current = controller.getSnapshot().items.find(item => item.id === selected.id);
      if (!operation.signal.aborted && enhancement.current === operation && current?.prompt === selected.prompt && current.enhancedPrompt === selected.enhancedPrompt && current.lora === selected.lora
        && generationLoraInstructions(current, projects?.getSnapshot().project?.loras, H3_MODEL_ID) === loraInstructions
        && JSON.stringify(current.keyframes ?? []) === JSON.stringify(selected.keyframes ?? [])
        && JSON.stringify(current.imageReferences ?? []) === JSON.stringify(selected.imageReferences ?? [])) {
        controller.edit(selected.id, promptEnhancementPatch(selected, result, !!editInstructions));
        return { applied: true };
      }
    } catch (error) {
      if (!operation.signal.aborted && enhancement.current === operation) {
        const message = error instanceof Error ? error.message : 'Try again.';
        if (!editInstructions) showErrorToast('Video prompt enhancement failed', message, selected.label);
        return { applied: false, error: message };
      }
    } finally {
      if (enhancement.current === operation) { enhancement.current = null; setEnhancing(false); setAnalyzing(false); }
    }
    return { applied: false, error: 'The prompt or settings changed. Try the edit again.' };
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
  const activePrompt = generationPrompt(selected);
  let validationError = '';
  const noVideo = hasNoVideoInput(selected);
  const hasSource = !!engine && !!info || !!(dependency?.reference?.before || dependency?.reference?.after);
  let comfyPlan: ReturnType<typeof comfyReferenceRange>['plan'] | undefined;
  try {
    const selectionError = promptSelectionError(selected);
    if (selectionError) throw new Error(selectionError);
    validateInterstitialDuration(selected.duration, compact ? 'comfy-loop' : method);
    validateMaskTransitionMs(selected.audioMaskTransitionMs ?? selected.maskTransitionMs ?? MASK_TRANSITION.defaultMs, 'Audio mask transition');
    validateMaskTransitionMs(selected.videoMaskTransitionMs ?? selected.maskTransitionMs ?? MASK_TRANSITION.defaultMs, 'Video mask transition');
    for (const curve of [selected.videoMaskCurve, selected.audioMaskCurve]) if (curve) maskCurveSchema.parse(curve);
    if (hasSource || noVideo) {
      const timing = dependency?.reference && referenceTiming(selected, dependency.reference);
      const input = timing ? { ...selected, time: timing.time } : selected;
      const duration = timing?.duration || info?.duration || selected.duration;
      comfyPlan = comfyReferenceRange(input, duration).plan;
      validateTimelineVideos(selected.timelineVideos, comfyPlan.middleFrames);
      const activeSettings = enabledImageReferences({ ...selected, prompt: activePrompt });
      validateVideoKeyframes(selected.keyframes, comfyPlan.middleFrames, selected.useInputReference === false && activeSettings.startImageIndex !== undefined, selected.useOutputReference === false && activeSettings.endImageIndex !== undefined || method === 'comfy-loop' && activeSettings.startImageIndex !== undefined);
      for (const keyframe of activeVideoKeyframes(selected.keyframes)) {
        const error = keyframe.image && assets.error(keyframe.image.assetId);
        if (error) throw new Error(`${keyframe.image!.name}: ${error}`);
      }
    }
    validateH3PromptLength(activePrompt);
  } catch (error) { validationError = (error as Error).message; }
  const canGenerate = (hasSource || noVideo) && !!status?.providers.comfy && !validationError && !dependency?.blocked && !!activePrompt.trim();
  const hasReferenceFootage = !!comfyPlan && !!(comfyPlan.prefixFrames || comfyPlan.suffixFrames);
  const analysisUnavailable = !hasReferenceFootage ? 'Choose valid start or end video footage to analyze.'
    : !status?.providers.gemini ? 'Connect Gemini to analyze reference videos.' : undefined;
  const enhancementUnavailable = addingImages ? 'Wait for reference images to finish loading.'
    : selected.analyzeReferences && hasReferenceFootage && !status?.providers.gemini ? analysisUnavailable : undefined;
  const referenceDescription = dependency?.reference?.mode === 'loop'
    ? dependency.reference.before ? `Uses the ending of ${dependency.label} as the shared start and end pose.` : selected.startImageIndex !== undefined ? `Picture ${selected.startImageIndex + 1} guides both the first and last frames of this loop.` : 'Generates a loop from the prompt without endpoint references.'
    : dependency ? dependency.reference?.before && dependency.reference?.after
    ? `Uses the connected input’s ending and output’s beginning.`
    : dependency.reference?.before ? `Uses the ending of ${dependency.label}.`
    : dependency.reference?.after ? `Uses the beginning of ${dependency.label}.` : 'Generates from the prompt without reference footage.' : '';
  const message = selected.error || validationError || dependency?.blocked || (status && !status.providers.comfy ? 'Comfy Cloud is not connected.' : '')
    || (busy ? phaseLabel(selected) : enhancing ? 'Enhancing prompt…' : '')
    || (dependency?.stale ? 'References changed · regenerate to match' : '')
    || (sequenced ? 'Waiting in sequence' : selected.phase === 'cancelled' ? 'Cancelled' : !activePrompt.trim() ? 'Add a prompt to generate' : changed ? 'Settings edited · ready to regenerate' : currentResult ? 'Video ready' : 'Ready to generate');
  const messages = [...new Set([message, referenceDescription, dependency?.stale && 'The saved video uses different references. Regenerate to match the current connections.',
    dependency?.blocked, ...(dependency?.issues ?? []).map(issue => issue.message), selected.error, validationError,
    busy && changed && 'This render uses the submitted settings. Your edits apply to the next generation.'].filter((value): value is string => !!value))];
  const progress = selected.phase === 'rendering' ? renderingProgress(selected) : selected.progress;
  const timeline = <GenerationTimelineEditor selected={selected} controller={controller} info={info} projects={projects} minDuration={minimumDuration(compact ? 'comfy-loop' : method)} onPreviewPlay={onPreviewPlay} onImagesBusyChange={setAddingImages}/>;
  const form = <form onSubmit={event => { event.preventDefault(); if (enhancing || sequenced || addingImages) return; if (recovering) void controller.resume(selected.id); else if (canGenerate) void controller.generate(selected.id, engine, info); }}>
    <fieldset>
      {!compact && <p className="hint">Comfy Cloud · {method === 'comfy-extend' ? 'H3 extension' : method === 'comfy-loop' ? 'H3 loop' : 'H3 bridge'}</p>}
      <GenerationLora key={`lora:${selected.id}`} model={H3_MODEL_ID} value={selected.lora} instructions={selected.loraInstructions} strength={selected.loraStrength} loras={projects?.getSnapshot().project?.loras} onChange={(lora, loraInstructions, loraStrength) => controller.edit(selected.id, { lora, loraInstructions, loraStrength })} onStrengthChange={loraStrength => controller.edit(selected.id, { loraStrength })} turbo={selected.turbo} onTurboChange={turbo => controller.edit(selected.id, { turbo })}/>
      <div className="field inspector-prompt">
        <div className="prompt-field-heading">
          <label htmlFor={promptId}>Original prompt</label>
          <span className="interstitial-edited" style={{ visibility: changed ? 'visible' : 'hidden' }} aria-hidden={!changed} title="Changes apply to the next generation">Edited</span>
          <label className="prompt-reference-analysis" title={analysisUnavailable ?? "Analyze reference clips when enhancing or editing"}><input id={analysisId} type="checkbox" aria-label="Analyze reference videos with AI" checked={selected.analyzeReferences === true} disabled={!!analysisUnavailable && !selected.analyzeReferences} onChange={event => controller.edit(selected.id, { analyzeReferences: event.target.checked })}/>Analyze references</label>
          <EnhancePromptActions key={selected.id} promptId={promptId} enhancing={enhancing} analyzing={analyzing} enabled={!!selected.prompt.trim() && !enhancementUnavailable} connected={!!status?.providers.openai}
            unavailableReason={enhancementUnavailable}
            editsBoth={!!selected.enhancedPrompt?.trim()} onEnhance={() => void enhance()} onEdit={enhance} onCancel={() => { enhancement.current?.abort(); enhancement.current = null; setEnhancing(false); setAnalyzing(false); }} />
        </div>
        <textarea id={promptId} aria-label="Video prompt" aria-describedby={`${promptId}-length`} rows={compact ? 3 : 4} maxLength={8000} placeholder="Describe the action, camera, sound…" value={selected.prompt} onChange={event => controller.edit(selected.id, { prompt: event.target.value })} />
        <span id={`${promptId}-length`} className="hint prompt-character-count">{normalizeH3Prompt(selected.prompt).length.toLocaleString('en-US')} / {H3_PROMPT_MAX_LENGTH.toLocaleString('en-US')} characters</span>
        <EnhancedPromptField value={selected} onChange={patch => controller.edit(selected.id, patch)} rows={compact ? 3 : 4} maxLength={H3_PROMPT_MAX_LENGTH}/>
        {!compact && (selected.continuity?.trim() || selected.dialogue?.trim()) && <p className="hint">Enhance this clip to include the shared brief and any saved dialogue. Generation sends the version selected above.</p>}
      </div>
      {timeline}
      <div className="field interstitial-resolution">
        <label className="interstitial-option" htmlFor={resolutionId}>
          <input id={resolutionId} type="checkbox" aria-label="Enable 2K regeneration" aria-describedby={`${resolutionId}-help`} checked={selected.resolution === '2k'}
            onChange={event=>controller.edit(selected.id,{resolution:event.target.checked?'2k':'native'})}/>
          Enable 2K regeneration (optional)
        </label>
        <p id={`${resolutionId}-help`} className="hint">Off by default: Native H3 output. Enable this to add the official H3-Regenerate-2K pass.</p>
      </div>
      <GenerationSeed key={`seed:${selected.id}`} value={selected.seed} lastSeed={currentResult?.metadata?.seed} baseOnly={selected.resolution === '2k'}
        onChange={seed => controller.edit(selected.id, { seed })} />
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
    {showOutput && <InterstitialOutput item={selected} projects={projects} details={resultDetails} compact={compact}
      loop={!compact && (kind === 'idle' || method === 'comfy-loop')} active={active} onPlay={onPreviewPlay}/>}
  </div>;
}
