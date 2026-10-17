import { INTERSTITIAL } from './constants.js';
import type { GenerationProgress, InsertionRange } from './contracts.js';

export type GenerationMethod = 'fal' | 'comfy';
export type InterstitialPhase = 'draft' | 'preparing' | 'uploading' | 'queued' | 'rendering' | 'loading' | 'ready' | 'error' | 'cancelled';
export type ClipReference = { sceneId: string; assetId: string; inFrame: number; outFrame: number };
export type GenerationReference = { before: ClipReference; after?: ClipReference };
export type InterstitialResult = { url: string; assetId?: string; start: number; duration: number; totalDuration: number; reference?: GenerationReference };
/** A single interstitial whose child clips share an interaction and branching timeline. */
export type CallResponseInterstitial = {
  id: string;
  kind: 'call-response';
  label: string;
  /** Insertion anchor in the original source video. */
  time: number;
  clipIds: string[];
};
export type InterstitialSettings = {
  method?: GenerationMethod;
  start_range: number; end_range: number; duration: number; prompt: string;
  enable_prompt_expansion: boolean;
};
export type Interstitial = InterstitialSettings & {
  id: string; label: string;
  /** Anchor in the original source, never in the expanded playback timeline. */
  time: number;
  /** Inputs submitted for the latest job, independent of the editable settings above. */
  generationSettings?: InterstitialSettings;
  phase: InterstitialPhase;
  requestId?: string;
  /** Provider and bounds of the submitted job; editing the selector cannot reroute it. */
  requestMethod?: GenerationMethod;
  requestInsertion?: InsertionRange;
  requestReference?: GenerationReference;
  result?: InterstitialResult;
  /** Last playable render, retained until a replacement has loaded and passed validation. */
  previousResult?: InterstitialResult;
  error?: string; progress?: number; queuePosition?: number;
  progressDetails?: GenerationProgress;
};
export const isGenerating = (item: Interstitial) => ['preparing', 'uploading', 'queued', 'rendering', 'loading'].includes(item.phase);
export const playableResult = (item: Interstitial) => item.phase === 'ready' ? item.result : item.previousResult;
export const interstitialSettings = ({ start_range, end_range, duration, prompt, enable_prompt_expansion, method = 'fal' }: InterstitialSettings): InterstitialSettings =>
  ({ start_range, end_range, duration, prompt, enable_prompt_expansion, method });
export const hasUnsubmittedChanges = (item: Interstitial) => !!item.generationSettings &&
  (Object.keys(interstitialSettings(item)) as (keyof InterstitialSettings)[]).some(key => interstitialSettings(item)[key] !== interstitialSettings(item.generationSettings!)[key]);
export const frameTime = (seconds: number, fps: number) => Math.round(seconds * fps) / fps;

export function validateInterstitialDuration(duration: number) {
  if (!Number.isFinite(duration) || duration < INTERSTITIAL.minDuration || duration > INTERSTITIAL.maxDuration) {
    throw new Error(`Duration must be between ${INTERSTITIAL.minDuration} and ${INTERSTITIAL.maxDuration} seconds.`);
  }
}

/** Reference timestamps use integer indices on fal's 24 fps frame clock. */
export function referenceResumeTime(start: number) {
  return (Math.round(start * INTERSTITIAL.referenceFps) + 1) / INTERSTITIAL.referenceFps;
}

/** The small replacement interval is only in the reference, not the master timeline. */
export function referenceRange(item: Pick<Interstitial, 'time' | 'start_range' | 'end_range'>, duration: number) {
  const fps = INTERSTITIAL.referenceFps;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Wait for the video to finish loading.');
  if (![item.time, item.start_range, item.end_range].every(Number.isFinite)) throw new Error('Enter valid start_range and end_range values.');
  if (item.start_range < INTERSTITIAL.minStartRange || item.start_range > INTERSTITIAL.maxRange) throw new Error('start_range must be between 1.625 and 4 seconds.');
  if (item.end_range < INTERSTITIAL.minEndRange || item.end_range > INTERSTITIAL.maxRange) throw new Error('end_range must be between 0.1 and 4 seconds.');
  const anchorFrame = Math.min(Math.floor(duration * fps + 1e-6), Math.round(Math.max(0, item.time) * fps));
  const anchor = anchorFrame / fps;
  const startFrame = Math.max(0, anchorFrame - Math.ceil(item.start_range * fps));
  const start = startFrame / fps;
  const end = Math.min(duration, anchor + Math.ceil(item.end_range * fps) / fps);
  const insertAt = (anchorFrame - startFrame) / fps;
  const resumeAt = referenceResumeTime(insertAt);
  if (insertAt + 1e-6 < INTERSTITIAL.minStartRange) throw new Error('This model needs at least 1.625 seconds before the draft. Move it farther from the beginning.');
  if (end - start - resumeAt < Math.max(1 / fps, 1 / INTERSTITIAL.referenceFps) - 1e-6) throw new Error('Leave more footage after the draft for the 24 fps return transition. Increase end_range or move the draft earlier.');
  return { start, end, insertAt, resumeAt, fps };
}
