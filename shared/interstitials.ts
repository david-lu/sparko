import { INTERSTITIAL } from './constants.js';
import type { GenerationProgress, InsertionRange } from './contracts.js';

export type GenerationMethod = 'comfy' | 'comfy-extend' | 'comfy-loop';
export const generationMethods = ['comfy', 'comfy-extend', 'comfy-loop'] as const;
export const normalizeGenerationMethod = (method: unknown): GenerationMethod => generationMethods.includes(method as GenerationMethod) ? method as GenerationMethod : 'comfy';
export const maskInjections = ['standard', 'uniform', 'vignette'] as const;
export type MaskInjection = typeof maskInjections[number];
export const normalizeMaskInjection = (value: unknown, legacyInterpolation?: unknown): MaskInjection =>
  maskInjections.includes(value as MaskInjection) ? value as MaskInjection : legacyInterpolation === true ? 'uniform' : 'standard';
export const clipMaskInjection = (item: Pick<InterstitialSettings, 'method' | 'maskInjection' | 'interpolateMiddle' | 'useInputReference' | 'useOutputReference'>): MaskInjection =>
  item.method === 'comfy-extend' || item.useInputReference === false || item.useOutputReference === false ? 'standard' : normalizeMaskInjection(item.maskInjection, item.interpolateMiddle);
export const minimumDuration = (method: GenerationMethod = 'comfy') => method === 'comfy-loop' ? INTERSTITIAL.minStartRange : INTERSTITIAL.minDuration;
export type InterstitialPhase = 'draft' | 'preparing' | 'uploading' | 'queued' | 'rendering' | 'loading' | 'ready' | 'error' | 'cancelled';
export type ClipReference = { sceneId: string; assetId: string; inFrame: number; outFrame: number };
export type GenerationReference = { before?: ClipReference; after?: ClipReference; mode?: 'extend' | 'loop' | 'bridge' | 'custom' };
export type InterstitialResult = { url: string; assetId?: string; /** Original output with reference sections, kept separately from the repeatable loop. */ fullAssetId?: string;
  /** Generated body boundaries in the original output, used to play its reference sections at transitions. */ fullRange?: InsertionRange;
  start: number; duration: number; totalDuration: number; reference?: GenerationReference; /** Exact prompt for this video, retained during regeneration. */ prompt?: string };
/** A single interstitial whose child clips share an interaction and branching timeline. */
export type CallResponseInterstitial = {
  id: string;
  kind: 'call-response';
  label: string;
  /** Insertion anchor in the original source video. */
  time: number;
  clipIds: string[];
  brief?: string;
  linkResponseDurations?: boolean;
};
export type InterstitialSettings = {
  method?: GenerationMethod;
  /** Story references come from the connected input/output; disabled sides contribute no footage. */
  useInputReference?: boolean; useOutputReference?: boolean;
  start_range: number; end_range: number; duration: number; prompt: string;
  enable_prompt_expansion: boolean;
  continuity?: string;
  dialogue?: string;
  loopAudio?: boolean;
  /** How the interpolated reference is injected into the next generation. */
  maskInjection?: MaskInjection;
  /** Read-only migration for projects saved with the original interpolation toggle. */
  interpolateMiddle?: boolean;
};
export type Interstitial = InterstitialSettings & {
  id: string; label: string;
  /** Anchor in the original source, never in the expanded playback timeline. */
  time: number;
  kind?: 'regular' | 'call-response';
  groupId?: string;
  /** Inputs submitted for the latest job, independent of the editable settings above. */
  generationSettings?: InterstitialSettings;
  phase: InterstitialPhase;
  requestId?: string;
  /** Provider and bounds of the submitted job; editing the selector cannot reroute it. */
  requestMethod?: GenerationMethod | 'fal'; // Read only when migrating an older saved project.
  /** Exact prompt sent for the latest accepted Comfy job. Older projects may not have this. */
  requestPrompt?: string;
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
export const interstitialSettings = ({ start_range, end_range, duration, prompt, enable_prompt_expansion, method = 'comfy', continuity, dialogue, loopAudio, maskInjection, interpolateMiddle, useInputReference, useOutputReference }: InterstitialSettings): InterstitialSettings =>
  ({ start_range, end_range, duration, prompt, enable_prompt_expansion, method, maskInjection: clipMaskInjection({ method, maskInjection, interpolateMiddle, useInputReference, useOutputReference }),
    ...(useInputReference !== undefined ? { useInputReference } : {}), ...(useOutputReference !== undefined ? { useOutputReference } : {}),
    ...(continuity !== undefined ? { continuity } : {}), ...(dialogue !== undefined ? { dialogue } : {}), ...(loopAudio !== undefined ? { loopAudio } : {}) });
export const hasUnsubmittedChanges = (item: Interstitial) => !!item.generationSettings &&
  ([...new Set([...Object.keys(interstitialSettings(item)), ...Object.keys(interstitialSettings(item.generationSettings))])] as (keyof InterstitialSettings)[])
    .some(key => !['loopAudio', 'continuity', 'dialogue'].includes(key) && interstitialSettings(item)[key] !== interstitialSettings(item.generationSettings!)[key]);
export const frameTime = (seconds: number, fps: number) => Math.round(seconds * fps) / fps;

export function validateInterstitialDuration(duration: number, method: GenerationMethod = 'comfy') {
  if (!Number.isFinite(duration) || duration < minimumDuration(method) || duration > INTERSTITIAL.maxDuration) {
    throw new Error(`Duration must be between ${minimumDuration(method)} and ${INTERSTITIAL.maxDuration} seconds.`);
  }
}
