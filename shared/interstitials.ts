import { LORA_STRENGTH } from './loras.js';
import { INTERSTITIAL, MASK_TRANSITION } from './constants.js';
import type { GenerationProgress, InsertionRange } from './contracts.js';
import type { ClipMetadata, ClipOrigin } from './clip-metadata.js';
import type { ImageReference } from './image-references.js';
import { maskCurveSchema, type MaskCurve } from './mask-curves.js';
import type { VideoAssetReference } from './video-references.js';
import { videoKeyframesSchema, type VideoKeyframe } from './video-keyframes.js';

export type GenerationMethod = 'comfy' | 'comfy-extend' | 'comfy-loop';
export const generationMethods = ['comfy', 'comfy-extend', 'comfy-loop'] as const;
export const generationResolutions = ['native', '2k'] as const;
export const referenceTypes = ['none', 'video', 'image'] as const;
export type ReferenceType = typeof referenceTypes[number];
export type GenerationResolution = typeof generationResolutions[number];
export const normalizeGenerationResolution = (value: unknown): GenerationResolution => value === '2k' ? '2k' : 'native';
export const normalizeGenerationMethod = (method: unknown): GenerationMethod => generationMethods.includes(method as GenerationMethod) ? method as GenerationMethod : 'comfy';
export const normalizeMaskTransitionMs = (value: unknown): number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MASK_TRANSITION.maxMs ? value : MASK_TRANSITION.defaultMs;
export function validateMaskTransitionMs(value: number, label = 'Mask transition') {
  if (!Number.isInteger(value) || value < 0 || value > MASK_TRANSITION.maxMs) throw new Error(`${label} must be between 0 and ${MASK_TRANSITION.maxMs} milliseconds.`);
}
/** Accept retired mode names only when reading older projects and metadata. */
export const maskInjections = ['standard', 'uniform', 'vignette'] as const;
export type MaskInjection = typeof maskInjections[number];
export const normalizeMaskInjection = (_value: unknown, _legacyInterpolation?: unknown): MaskInjection => 'standard';
export const clipMaskInjection = (_item: Pick<InterstitialSettings, 'method' | 'maskInjection' | 'interpolateMiddle' | 'useInputReference' | 'useOutputReference'>): MaskInjection => 'standard';
export const minimumDuration = (method: GenerationMethod = 'comfy') => method === 'comfy-loop' ? INTERSTITIAL.minStartRange : INTERSTITIAL.minDuration;
export type InterstitialPhase = 'draft' | 'preparing' | 'uploading' | 'queued' | 'rendering' | 'loading' | 'ready' | 'error' | 'cancelled';
export type ClipReference = { kind?: 'image'|'audio'; sceneId: string; assetId: string; inFrame: number; outFrame: number };
export type GenerationReference = { before?: ClipReference; after?: ClipReference; beforeClips?: ClipReference[]; afterClips?: ClipReference[]; mode?: 'extend' | 'loop' | 'bridge' | 'custom' };
export type InterstitialResult = { url: string; assetId?: string; /** Portable render provenance; reference IDs here may belong to another project. */ metadata?: ClipMetadata;
  /** Original output with reference sections, kept separately from the repeatable loop. */ fullAssetId?: string;
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
  /** Copied from the project when created; null explicitly disables LoRA. */
  lora?: string | null;
  /** Custom prompt-enhancement guidance; absent values use the matching project LoRA's instructions. */
  loraInstructions?: string;
  /** Copied on creation or LoRA selection; missing values retain the legacy strength of 1. */
  loraStrength?: number;
  /** Stack the H3 Turbo adapter with the optional character/style LoRA. Off for older projects. */
  turbo?: boolean;
  /** Undefined selects a new random seed for each generation. Zero is a valid fixed seed. */
  seed?: number;
  /** Ordered H3 references, addressed as <Picture 1>, <Picture 2>, etc. */
  imageReferences?: ImageReference[];
  keyframes?: VideoKeyframe[];
  /** Zero-based Picture indexes used as first/last-frame guides when footage is disabled. */
  startImageIndex?: number; endImageIndex?: number;
  startReferenceType?: ReferenceType; endReferenceType?: ReferenceType;
  useStartVideoAsset?: boolean; useEndVideoAsset?: boolean;
  startVideoAsset?: VideoAssetReference; endVideoAsset?: VideoAssetReference;
  startVideoAssets?: VideoAssetReference[]; endVideoAssets?: VideoAssetReference[];
  method?: GenerationMethod;
  resolution?: GenerationResolution;
  /** Story references come from the connected input/output; disabled sides contribute no footage. */
  useInputReference?: boolean; useOutputReference?: boolean;
  start_range: number; end_range: number; duration: number; prompt: string;
  enable_prompt_expansion: boolean;
  continuity?: string;
  dialogue?: string;
  /** Analyze the exact reference video windows before enhancing or editing this prompt. */
  analyzeReferences?: boolean;
  /** Legacy metadata only; playback uses asset volume instead. */
  loopAudio?: boolean;
  /** Read-only compatibility with retired FILM masks; new generations use pin curves. */
  maskInjection?: MaskInjection;
  /** Independent soft masks inside each connected reference; 0 disables that media's ramp. */
  audioMaskTransitionMs?: number;
  videoMaskTransitionMs?: number;
  /** Optional reference envelopes; absent curves retain the simple duration controls. */
  audioMaskCurve?: MaskCurve;
  videoMaskCurve?: MaskCurve;
  /** Read-only migration for projects saved with one shared audio/video duration. */
  maskTransitionMs?: number;
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
  /** Actual sampling seed chosen for this job, separate from the next generation settings. */
  requestSeed?: number;
  requestInsertion?: InsertionRange;
  requestReference?: GenerationReference;
  /** Clip identity, behaviors and named references captured at submission. */
  requestOrigin?: ClipOrigin;
  result?: InterstitialResult;
  /** Last playable render, retained until a replacement has loaded and passed validation. */
  previousResult?: InterstitialResult;
  error?: string; progress?: number; queuePosition?: number;
  progressDetails?: GenerationProgress;
};
export const isGenerating = (item: Interstitial) => ['preparing', 'uploading', 'queued', 'rendering', 'loading'].includes(item.phase);
export const playableResult = (item: Interstitial) => item.phase === 'ready' ? item.result : item.previousResult;
// Keep Turbo's off value explicit so undo can clear a previously enabled setting.
export const interstitialSettings = ({ lora, loraInstructions, loraStrength, turbo, seed, useStartVideoAsset, useEndVideoAsset, startVideoAsset, endVideoAsset, startVideoAssets, endVideoAssets, start_range, end_range, duration, prompt, enable_prompt_expansion, method = 'comfy', resolution, continuity, dialogue, analyzeReferences, loopAudio, maskInjection, audioMaskTransitionMs, videoMaskTransitionMs, audioMaskCurve, videoMaskCurve, maskTransitionMs, interpolateMiddle, useInputReference, useOutputReference, imageReferences, keyframes, startImageIndex, endImageIndex, startReferenceType, endReferenceType }: InterstitialSettings): InterstitialSettings =>
  ({ ...(lora !== undefined ? { lora } : {}), ...(loraInstructions !== undefined ? { loraInstructions } : {}), ...(loraStrength !== undefined ? { loraStrength } : {}), turbo: turbo === true, ...(seed !== undefined ? { seed } : {}), start_range, end_range, duration, prompt, enable_prompt_expansion, method, resolution: normalizeGenerationResolution(resolution), maskInjection: clipMaskInjection({ method, maskInjection, interpolateMiddle, useInputReference, useOutputReference }),
    ...(useStartVideoAsset !== undefined ? { useStartVideoAsset } : {}), ...(useEndVideoAsset !== undefined ? { useEndVideoAsset } : {}),
    ...(startVideoAsset ? { startVideoAsset: { ...startVideoAsset } } : {}), ...(endVideoAsset ? { endVideoAsset: { ...endVideoAsset } } : {}),
    ...(startVideoAssets ? { startVideoAssets: startVideoAssets.map(ref => ({ ...ref })) } : {}),
    ...(endVideoAssets ? { endVideoAssets: endVideoAssets.map(ref => ({ ...ref })) } : {}),
    ...(keyframes !== undefined ? { keyframes: videoKeyframesSchema.parse(keyframes) } : {}),
    ...(imageReferences?.length ? { imageReferences: imageReferences.map(image => ({ ...image })) } : {}),
    ...(startImageIndex !== undefined ? { startImageIndex } : {}), ...(endImageIndex !== undefined ? { endImageIndex } : {}),
    ...(startReferenceType !== undefined ? { startReferenceType } : {}), ...(endReferenceType !== undefined ? { endReferenceType } : {}),
    audioMaskTransitionMs: normalizeMaskTransitionMs(audioMaskTransitionMs ?? maskTransitionMs),
    videoMaskTransitionMs: normalizeMaskTransitionMs(videoMaskTransitionMs ?? maskTransitionMs),
    ...(audioMaskCurve ? { audioMaskCurve: maskCurveSchema.parse(audioMaskCurve) } : {}),
    ...(videoMaskCurve ? { videoMaskCurve: maskCurveSchema.parse(videoMaskCurve) } : {}),
    ...(useInputReference !== undefined ? { useInputReference } : {}), ...(useOutputReference !== undefined ? { useOutputReference } : {}),
    ...(continuity !== undefined ? { continuity } : {}), ...(dialogue !== undefined ? { dialogue } : {}), ...(analyzeReferences !== undefined ? { analyzeReferences } : {}), ...(loopAudio !== undefined ? { loopAudio } : {}) });
export const hasUnsubmittedChanges = (item: Interstitial) => !!item.generationSettings &&
  ([...new Set([...Object.keys(interstitialSettings(item)), ...Object.keys(interstitialSettings(item.generationSettings))])] as (keyof InterstitialSettings)[])
    .some(key => !['loopAudio', 'continuity', 'dialogue', 'loraInstructions', 'analyzeReferences'].includes(key) && (['imageReferences', 'keyframes', 'audioMaskCurve', 'videoMaskCurve', 'startVideoAsset', 'endVideoAsset', 'startVideoAssets', 'endVideoAssets'].includes(key)
      ? JSON.stringify(item[key] ?? []) !== JSON.stringify(item.generationSettings![key] ?? [])
      : key === 'loraStrength' ? !!(item.lora || item.generationSettings!.lora) && (item.loraStrength ?? LORA_STRENGTH.default) !== (item.generationSettings!.loraStrength ?? LORA_STRENGTH.default)
      : key === 'lora' ? (item.lora ?? null) !== (item.generationSettings!.lora ?? null)
      : interstitialSettings(item)[key] !== interstitialSettings(item.generationSettings!)[key]));
export const frameTime = (seconds: number, fps: number) => Math.round(seconds * fps) / fps;

export function validateInterstitialDuration(duration: number, method: GenerationMethod = 'comfy') {
  if (!Number.isFinite(duration) || duration < minimumDuration(method) || duration > INTERSTITIAL.maxDuration) {
    throw new Error(`Duration must be between ${minimumDuration(method)} and ${INTERSTITIAL.maxDuration} seconds.`);
  }
}
