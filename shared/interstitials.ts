import { INTERSTITIAL } from './constants.js';
import type { GenerationProgress, InsertionRange } from './contracts.js';

export type GenerationMethod = 'comfy' | 'comfy-extend' | 'comfy-loop';
export const generationMethods = ['comfy', 'comfy-extend', 'comfy-loop'] as const;
export const normalizeGenerationMethod = (method: unknown): GenerationMethod => generationMethods.includes(method as GenerationMethod) ? method as GenerationMethod : 'comfy';
export const minimumDuration = (method: GenerationMethod = 'comfy') => method === 'comfy-loop' ? INTERSTITIAL.minStartRange : INTERSTITIAL.minDuration;
export type InterstitialPhase = 'draft' | 'preparing' | 'uploading' | 'queued' | 'rendering' | 'loading' | 'ready' | 'error' | 'cancelled';
export type ClipReference = { sceneId: string; assetId: string; inFrame: number; outFrame: number };
export type GenerationReference = { before: ClipReference; after?: ClipReference; mode?: 'extend' | 'loop' | 'bridge' };
export type InterstitialResult = { url: string; assetId?: string; start: number; duration: number; totalDuration: number; reference?: GenerationReference };
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
  start_range: number; end_range: number; duration: number; prompt: string;
  enable_prompt_expansion: boolean;
  continuity?: string;
  dialogue?: string;
  loopAudio?: boolean;
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
export const interstitialSettings = ({ start_range, end_range, duration, prompt, enable_prompt_expansion, method = 'comfy', continuity, dialogue, loopAudio }: InterstitialSettings): InterstitialSettings =>
  ({ start_range, end_range, duration, prompt, enable_prompt_expansion, method, ...(continuity !== undefined ? { continuity } : {}), ...(dialogue !== undefined ? { dialogue } : {}), ...(loopAudio !== undefined ? { loopAudio } : {}) });
export const generationPrompt = (item: Pick<InterstitialSettings, 'continuity' | 'prompt' | 'dialogue'>) => [item.continuity?.trim(), item.prompt.trim(),
  item.dialogue?.trim() ? `Spoken dialogue, verbatim: ${item.dialogue.trim()}` : ''].filter(Boolean).join('\n\n');
/** Bring legacy speech instructions into the visible prompt without changing submitted text. */
export function promptOnlySettings<T extends InterstitialSettings>(settings: T): T {
  if (settings.dialogue === undefined) return settings;
  return { ...settings, prompt: generationPrompt({ ...settings, continuity: undefined }), dialogue: undefined };
}
export const hasUnsubmittedChanges = (item: Interstitial) => !!item.generationSettings &&
  ([...new Set([...Object.keys(interstitialSettings(item)), ...Object.keys(interstitialSettings(item.generationSettings))])] as (keyof InterstitialSettings)[]).some(key => interstitialSettings(item)[key] !== interstitialSettings(item.generationSettings!)[key]);
export const frameTime = (seconds: number, fps: number) => Math.round(seconds * fps) / fps;

export function validateInterstitialDuration(duration: number, method: GenerationMethod = 'comfy') {
  if (!Number.isFinite(duration) || duration < minimumDuration(method) || duration > INTERSTITIAL.maxDuration) {
    throw new Error(`Duration must be between ${minimumDuration(method)} and ${INTERSTITIAL.maxDuration} seconds.`);
  }
}
