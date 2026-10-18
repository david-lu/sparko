import { INTERSTITIAL } from './constants.js';
import type { GenerationProgress, InsertionRange } from './contracts.js';

export type GenerationMethod = 'comfy' | 'comfy-extend' | 'comfy-loop';
export const generationMethods = ['comfy', 'comfy-extend', 'comfy-loop'] as const;
export const normalizeGenerationMethod = (method: unknown): GenerationMethod => generationMethods.includes(method as GenerationMethod) ? method as GenerationMethod : 'comfy';
export const minimumDuration = (method: GenerationMethod = 'comfy') => method === 'comfy-loop' ? INTERSTITIAL.minStartRange : INTERSTITIAL.minDuration;
export type InterstitialPhase = 'draft' | 'preparing' | 'uploading' | 'queued' | 'rendering' | 'loading' | 'ready' | 'error' | 'cancelled';
export type ClipReference = { sceneId: string; assetId: string; inFrame: number; outFrame: number };
export type GenerationReference = { before: ClipReference; after?: ClipReference; mode?: 'extend' | 'loop' | 'bridge' };
export type InterstitialResult = { url: string; assetId?: string; /** Original output with reference sections, kept separately from the repeatable loop. */ fullAssetId?: string;
  /** Generated body boundaries in the original output, used to play its reference sections at transitions. */ fullRange?: InsertionRange;
  start: number; duration: number; totalDuration: number; reference?: GenerationReference };
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
export const interstitialSettings = ({ start_range, end_range, duration, prompt, enable_prompt_expansion, method = 'comfy', continuity, dialogue, loopAudio }: InterstitialSettings): InterstitialSettings =>
  ({ start_range, end_range, duration, prompt, enable_prompt_expansion, method, ...(continuity !== undefined ? { continuity } : {}), ...(dialogue !== undefined ? { dialogue } : {}), ...(loopAudio !== undefined ? { loopAudio } : {}) });
function combineH3Prompt(prompt: string, context: string | undefined, dialogue?: string) {
  const body = prompt.trim();
  const additions = [context?.trim(), dialogue].filter(Boolean).join(' ');
  if (body.startsWith('integrated_multimodal_description: [Shot 1] ') && body.includes('\noverall_soundscape: ')) {
    const soundscape = body.indexOf('\noverall_soundscape: ');
    return `${body.slice(0, soundscape)} ${additions}${body.slice(soundscape)}`.replace(/ +\n/g, '\n');
  }
  return [context?.trim(), body, dialogue].filter(Boolean).join('\n\n');
}
export function generationPrompt(item: Pick<InterstitialSettings, 'method' | 'continuity' | 'prompt' | 'dialogue'>) {
  if (item.method === 'comfy-loop') {
    // A loop can inherit a speech instruction from an enhanced Call or a shared brief.
    // Keep the visual directions, but never ask H3 to speak during Idle.
    const withoutSpeech = (value: string | undefined) => value?.replace(/\bEnglish speech only\.?/gi, '')
      .replace(/The character \(S1\) says once: <d>[\s\S]*?<\/d>\. After speaking, they keep their mouth closed and remain silent\./gi, '')
      .replace(/(?:^|\n)\s*Spoken dialogue, verbatim:[^\n]*/gi, '')
      .replace(/<d>\[[^\]]+\][\s\S]*?<\/d>/gi, '').trim();
    return combineH3Prompt(withoutSpeech(item.prompt) ?? '', withoutSpeech(item.continuity),
      'The character stays silent with their mouth closed throughout the generated loop. No speech, dialogue or lip movement. Only subtle ambient sound.');
  }
  const dialogue = item.dialogue?.trim()
    ? `The character (S1) says once: <d>[English] ${item.dialogue.trim()}</d>. After speaking, they keep their mouth closed and remain silent.` : undefined;
  return combineH3Prompt(item.prompt, item.continuity, dialogue);
}
/** Bring legacy speech instructions into the visible prompt without changing submitted text. */
export function promptOnlySettings<T extends InterstitialSettings>(settings: T): T {
  if (settings.dialogue === undefined) return settings;
  return { ...settings, prompt: generationPrompt({ prompt: settings.prompt, dialogue: settings.dialogue }), dialogue: undefined };
}
export const hasUnsubmittedChanges = (item: Interstitial) => !!item.generationSettings &&
  ([...new Set([...Object.keys(interstitialSettings(item)), ...Object.keys(interstitialSettings(item.generationSettings))])] as (keyof InterstitialSettings)[])
    .some(key => key !== 'loopAudio' && interstitialSettings(item)[key] !== interstitialSettings(item.generationSettings!)[key]);
export const frameTime = (seconds: number, fps: number) => Math.round(seconds * fps) / fps;

export function validateInterstitialDuration(duration: number, method: GenerationMethod = 'comfy') {
  if (!Number.isFinite(duration) || duration < minimumDuration(method) || duration > INTERSTITIAL.maxDuration) {
    throw new Error(`Duration must be between ${minimumDuration(method)} and ${INTERSTITIAL.maxDuration} seconds.`);
  }
}
