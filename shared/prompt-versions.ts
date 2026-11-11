import { z } from 'zod';

export const enhancedPromptSettings = {
  enhancedPrompt: z.string().max(8000).optional(),
  enhancedPromptStale: z.boolean().optional(),
  useEnhancedPrompt: z.boolean().optional(),
};
export type PromptVersions = { prompt: string; enhancedPrompt?: string; enhancedPromptStale?: boolean; useEnhancedPrompt?: boolean };

export const generationPrompt = (settings: PromptVersions) => settings.useEnhancedPrompt ? settings.enhancedPrompt ?? '' : settings.prompt;
export function promptSelectionError(settings: PromptVersions): string | undefined {
  if (!settings.useEnhancedPrompt) return;
  if (!settings.enhancedPrompt?.trim()) return 'Enhance the original prompt or choose Original for generation.';
  if (settings.enhancedPromptStale) return 'The enhanced prompt needs updating. Enhance, edit both with AI, or choose Original for generation.';
}

// Only changes to enhancement inputs invalidate the downstream text. Seed, output
// resolution, and the choice of prompt do not change the meaning of the brief.
const inputs = new Set(['prompt', 'duration', 'continuity', 'dialogue', 'time', 'model', 'aspectRatio', 'references',
  'lora', 'loraInstructions', 'imageReferences', 'keyframes', 'timelineVideos', 'start_range', 'end_range', 'method',
  'useInputReference', 'useOutputReference', 'useStartVideoAsset', 'useEndVideoAsset', 'startVideoAsset', 'endVideoAsset',
  'startVideoAssets', 'endVideoAssets', 'startImageIndex', 'endImageIndex', 'startReferenceType', 'endReferenceType',
  'audioMaskCurve', 'audioMaskTransitionMs', 'characterIds', 'instrumental', 'loop', 'autoDuration', 'languageCode']);
export function promptSettingsPatch<T extends PromptVersions>(current: T, patch: Partial<T>): Partial<T> {
  if ('enhancedPrompt' in patch) return { ...patch, enhancedPromptStale: false };
  if (current.enhancedPrompt?.trim() && Object.keys(patch).some(key => inputs.has(key)
    && JSON.stringify(current[key as keyof T]) !== JSON.stringify(patch[key as keyof T]))) return { ...patch, enhancedPromptStale: true };
  return patch;
}

/** Require both response fields before applying a paired edit; do not judge their content. */
export function promptEnhancementPatch(current: PromptVersions, result: { prompt: string; enhancedPrompt?: string }, editing: boolean): Partial<PromptVersions> {
  const valid = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
  if (!valid(result.prompt) || (editing && current.enhancedPrompt?.trim() && !valid(result.enhancedPrompt))) {
    throw new Error('The edit did not return both complete prompts. Your prompts have been kept. Try again.');
  }
  if (!editing) return { enhancedPrompt: result.prompt, enhancedPromptStale: false, useEnhancedPrompt: true };
  return { prompt: result.prompt, ...(current.enhancedPrompt?.trim() ? { enhancedPrompt: result.enhancedPrompt, enhancedPromptStale: false } : {}) };
}
