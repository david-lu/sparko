import { MASK_TRANSITION, TIMELINE_FPS } from '../../../shared/constants';
import { defaultMaskCurve } from '../../../shared/mask-curves';
import type { PromptClipKind, PromptEnhancement } from '../../../shared/contracts';
import type { GenerationReference, Interstitial } from '../../../shared/interstitials';
import { sampleFrame, type MediaInfo } from '../../media/media';
import type { MediaEngine } from '../../media/MediaEngine';
import { request } from '../../shared/api';
import { assets } from '../project/assets';
import { referenceImagePreviews } from './image-references';
import { capturePromptFrame, type PromptFramePlayer } from '../player/promptFrame';
import { comfyReferenceRange } from '../../../shared/comfy';
import { referenceTiming } from '../../../shared/reference-clips';
import type { PromptReferenceTiming, PromptReferenceDescription } from '../../../shared/prompt-timing';
import { analyzePromptReferences } from './analyze-prompt-references';

type PromptItem = Pick<Interstitial, 'prompt' | 'time' | 'duration' | 'continuity' | 'dialogue' | 'imageReferences' | 'startImageIndex' | 'endImageIndex' | 'loraInstructions'>
  & Partial<Pick<Interstitial, 'start_range' | 'end_range' | 'method' | 'resolution' | 'useInputReference' | 'useOutputReference' | 'analyzeReferences' | 'audioMaskCurve' | 'audioMaskTransitionMs' | 'maskTransitionMs'>>;
function promptReferences(item: PromptItem, reference: GenerationReference | undefined, sourceDuration?: number): PromptReferenceTiming | undefined {
  if (item.start_range === undefined || item.end_range === undefined) return;
  const settings = { ...item, start_range: item.start_range, end_range: item.end_range };
  const timing = reference && (reference.before || reference.after) ? referenceTiming(settings, reference) : undefined;
  if (!timing && !sourceDuration && !(item.useInputReference === false && item.useOutputReference === false)) return;
  const { plan } = comfyReferenceRange(timing ? { ...settings, time: timing.time } : settings, timing?.duration || sourceDuration || item.duration);
  return { prefixFrames: plan.prefixFrames, suffixFrames: plan.suffixFrames };
}

export async function enhancePrompt(item: PromptItem, kind: PromptClipKind, reference: GenerationReference | undefined,
  engine: MediaEngine | null, info: MediaInfo | null, signal: AbortSignal, { target, player, editInstructions, onAnalyzing }: { target?: 'continuity'; player?: PromptFramePlayer; editInstructions?: string; onAnalyzing?: (active: boolean) => void } = {}) {
  const referenceTiming = target === 'continuity' ? undefined : promptReferences(item, reference, info?.duration);
  const currentFrame = await capturePromptFrame(player, signal);
  const referenceFrames: string[] = [];
  if (reference) {
    if (reference.before) {
    const before = await assets.open(reference.before.assetId);
    referenceFrames.push((await sampleFrame({ id: reference.before.assetId, name: 'Preceding clip', kind: reference.before.kind, url: before.url }, (reference.before.outFrame - 1) / TIMELINE_FPS, 512, signal)).url);
    }
    if (reference.after) {
      const after = await assets.open(reference.after.assetId);
      referenceFrames.push((await sampleFrame({ id: reference.after.assetId, name: 'Following clip', kind: reference.after.kind, url: after.url }, (reference.mode === 'loop' ? reference.after.outFrame - 1 : reference.after.inFrame) / TIMELINE_FPS, 512, signal)).url);
    }
  } else if (engine && info) {
    const last = Math.max(0, info.duration - 1 / info.fps);
    for (const time of [Math.max(0, Math.min(last, item.time - 1 / TIMELINE_FPS)), Math.max(0, Math.min(last, item.time))]) {
      referenceFrames.push((await sampleFrame(engine.source, time, 512, signal)).url);
    }
  }
  signal.throwIfAborted();
  const imageReferences = await referenceImagePreviews(item.imageReferences, signal);
  signal.throwIfAborted();
  let referenceDescriptions: PromptReferenceDescription[] | undefined;
  if (item.analyzeReferences && referenceTiming && (referenceTiming.prefixFrames || referenceTiming.suffixFrames)) {
    onAnalyzing?.(true);
    try { referenceDescriptions = await analyzePromptReferences({ ...item, start_range: item.start_range!, end_range: item.end_range! }, reference, engine, info, signal); }
    finally { onAnalyzing?.(false); }
  }
  signal.throwIfAborted();
  const referenceAudioMask = referenceDescriptions?.length && referenceTiming ? item.audioMaskCurve
    ?? defaultMaskCurve(referenceTiming.prefixFrames / TIMELINE_FPS, referenceTiming.suffixFrames / TIMELINE_FPS, item.audioMaskTransitionMs ?? item.maskTransitionMs ?? MASK_TRANSITION.defaultMs) : undefined;
  return request<PromptEnhancement>('/api/interstitials/enhance-prompt', { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: item.prompt, editInstructions, duration: item.duration, kind, target, currentFrame, referenceFrames, referenceTiming, referenceDescriptions, referenceAudioMask, imageReferences,
      imageGuides: { start: item.startImageIndex, end: item.endImageIndex }, continuity: item.continuity, dialogue: item.dialogue, loraInstructions: item.loraInstructions }) });
}
