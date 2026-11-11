import { enhancedPromptSettings, generationPrompt, promptSelectionError } from './prompt-versions.js';
import { z } from 'zod';
import { loraSettings, projectLoraAddress, projectLoraStrength, type ProjectLora } from './loras.js';
import { characterContext, characterIdsSchema, characterNameSchema, characterVoiceSchema, featuredCharacters, selectedCharacters, type ProjectCharacter } from './characters.js';
import { DIALOGUE_MAX_SPEAKERS, dialogueTextError } from './dialogue-script.js';

export type MediaKind = 'image' | 'video' | 'audio';
export type AssetProvider = 'fal' | 'elevenlabs';
export type AudioType = 'dialogue' | 'music' | 'sound-effects';
export type AssetModel = { id: string; name: string; kind: MediaKind; provider: AssetProvider; endpoint: string; editEndpoint?: string; inputs: MediaKind[]; maxImages: number; resolutions: string[];
  /** ElevenLabs only: the API model_id and which kind of audio it creates. */
  providerModel?: string; audioType?: AudioType };
export const ASSET_MODELS: AssetModel[] = [
  { id: 'nano-banana-2', name: 'Nano Banana 2', kind: 'image', provider: 'fal', endpoint: 'fal-ai/nano-banana-2', editEndpoint: 'fal-ai/nano-banana-2/edit', inputs: ['image', 'video', 'audio'], maxImages: 14, resolutions: ['1K', '2K', '4K'] },
  { id: 'flux-2-pro', name: 'FLUX.2 Pro', kind: 'image', provider: 'fal', endpoint: 'fal-ai/flux-2-pro', editEndpoint: 'fal-ai/flux-2-pro/edit', inputs: ['image'], maxImages: 9, resolutions: ['1K', '2K'] },
  { id: 'seedream-4.5', name: 'Seedream 4.5', kind: 'image', provider: 'fal', endpoint: 'fal-ai/bytedance/seedream/v4.5/text-to-image', editEndpoint: 'fal-ai/bytedance/seedream/v4.5/edit', inputs: ['image'], maxImages: 10, resolutions: ['2K', '4K'] },
  { id: 'nano-banana-pro', name: 'Nano Banana Pro', kind: 'image', provider: 'fal', endpoint: 'fal-ai/nano-banana-pro', editEndpoint: 'fal-ai/nano-banana-pro/edit', inputs: ['image'], maxImages: 14, resolutions: ['1K', '2K', '4K'] },
  { id: 'flux-2-max', name: 'FLUX.2 Max', kind: 'image', provider: 'fal', endpoint: 'fal-ai/flux-2-max', editEndpoint: 'fal-ai/flux-2-max/edit', inputs: ['image'], maxImages: 8, resolutions: ['1K', '2K'] },
  { id: 'ideogram-v3', name: 'Ideogram 3.0', kind: 'image', provider: 'fal', endpoint: 'fal-ai/ideogram/v3', inputs: [], maxImages: 0, resolutions: ['1K'] },
  // Audio is generated directly with ElevenLabs. Model IDs follow ElevenLabs' current recommendations (reviewed 2026-11-10).
  { id: 'elevenlabs-dialogue', name: 'Dialogue · ElevenLabs v4', kind: 'audio', provider: 'elevenlabs', endpoint: 'v1/text-to-dialogue', providerModel: 'eleven_v4', audioType: 'dialogue', inputs: [], maxImages: 0, resolutions: [] },
  { id: 'elevenlabs-music', name: 'Music · Eleven Music v2.5', kind: 'audio', provider: 'elevenlabs', endpoint: 'v1/music', providerModel: 'music_v2_5', audioType: 'music', inputs: [], maxImages: 0, resolutions: [] },
  { id: 'elevenlabs-sound-effects', name: 'Sound effects · ElevenLabs v3', kind: 'audio', provider: 'elevenlabs', endpoint: 'v1/sound-generation', providerModel: 'eleven_text_to_sound_v3', audioType: 'sound-effects', inputs: [], maxImages: 0, resolutions: [] },
];
// Retain names and queue paths for saved projects and already-submitted jobs. New generations cannot use them.
const legacyModels: AssetModel[] = [
  { id: 'kling-video', name: 'Kling 2.6 Pro', kind: 'video', provider: 'fal', endpoint: 'fal-ai/kling-video/v2.6/pro/text-to-video', inputs: ['image'], maxImages: 1, resolutions: [] },
  { id: 'sound-effects', name: 'ElevenLabs Sound Effects (fal)', kind: 'audio', provider: 'fal', endpoint: 'fal-ai/elevenlabs/sound-effects/v2', inputs: [], maxImages: 0, resolutions: [] },
  { id: 'stable-audio-2.5', name: 'Stable Audio 2.5', kind: 'audio', provider: 'fal', endpoint: 'fal-ai/stable-audio-25/text-to-audio', editEndpoint: 'fal-ai/stable-audio-25/audio-to-audio', inputs: ['audio'], maxImages: 0, resolutions: [] },
];
/** Drafts from retired audio models move to their closest ElevenLabs replacement. */
export const LEGACY_AUDIO_REPLACEMENTS: Record<string, string> = { 'sound-effects': 'elevenlabs-sound-effects', 'stable-audio-2.5': 'elevenlabs-music' };
/** Duration limits in seconds for each audio type with a fixed length. */
export const AUDIO_DURATION_LIMITS: Partial<Record<AudioType, { min: number; max: number; step: number }>> = {
  music: { min: 3, max: 300, step: 1 }, 'sound-effects': { min: .5, max: 30, step: .1 },
};
export const SOUND_EFFECT_PROMPT_MAX_LENGTH = 450;
export const DIALOGUE_STABILITY = [
  { value: 0, label: 'Creative', description: 'Most expressive and responsive to audio tags; can be less predictable.' },
  { value: .5, label: 'Natural', description: 'Balanced, closest to the original voice.' },
  { value: 1, label: 'Robust', description: 'Most consistent, but responds less to audio tags.' },
] as const;
export const DIALOGUE_LANGUAGES = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'],
  ['sv', 'Swedish'], ['tr', 'Turkish'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['id', 'Indonesian'], ['vi', 'Vietnamese']] as const;
export const assetModel = (id: string) => ASSET_MODELS.find(model => model.id === id) ?? legacyModels.find(model => model.id === id);
export const mediaKindSchema = z.enum(['image', 'video', 'audio']);
export const assetReferenceSchema = z.object({ assetId: z.uuid(), name: z.string().min(1).max(1000), kind: mediaKindSchema });
export const assetSettingsSchema = z.object({
  ...loraSettings,
  ...enhancedPromptSettings,
  model: z.string().max(100).refine(id => !!assetModel(id), 'Choose a supported model.'),
  prompt: z.string().max(8000), references: z.array(assetReferenceSchema).max(16),
  aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']), resolution: z.enum(['1K', '2K', '4K']),
  // Older projects and submitted jobs can retain batch counts; new submissions require one output.
  count: z.number().int().min(1).max(4), duration: z.number().min(.5).max(300),
  // ElevenLabs audio. Optional so earlier projects and other models stay valid.
  /** Music and sound effects: let ElevenLabs choose the length from the prompt. */
  autoDuration: z.boolean().optional(),
  /** Music: generate without vocals. */
  instrumental: z.boolean().optional(),
  /** Sound effects: 0 is most creative, 1 follows the prompt most literally. */
  promptInfluence: z.number().min(0).max(1).optional(),
  /** Sound effects: make the result loop seamlessly. */
  loop: z.boolean().optional(),
  /** Dialogue: Creative 0, Natural 0.5 or Robust 1. */
  stability: z.union([z.literal(0), z.literal(.5), z.literal(1)]).optional(),
  /** Dialogue: ISO 639-1 language code; omitted to detect it from the text. */
  languageCode: z.string().regex(/^[a-z]{2}$/).optional(),
  seed: z.number().int().min(0).max(4294967295).optional(),
  /** Characters this generation features. Image models receive their reference images; prompts receive their descriptions. */
  characterIds: characterIdsSchema.optional(),
  /** Dialogue: each speaker's voice, resolved from the project's characters when submitted. */
  dialogueVoices: z.array(z.object({ speaker: characterNameSchema, voiceId: characterVoiceSchema.shape.id, voiceName: characterVoiceSchema.shape.name })).max(DIALOGUE_MAX_SPEAKERS).optional(),
});
export type AssetSettings = z.infer<typeof assetSettingsSchema>;
export type AssetReference = z.infer<typeof assetReferenceSchema>;
export const assetGenerationSchema = z.object({
  id: z.uuid(), name: z.string().min(1).max(1000), kind: mediaKindSchema, folderId: z.uuid().optional(),
  settings: assetSettingsSchema,
  phase: z.enum(['draft', 'preparing', 'queued', 'rendering', 'loading', 'ready', 'error', 'cancelled']),
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/).optional(), submitted: assetSettingsSchema.optional(),
  error: z.string().max(3000).optional(), selectedAssetId: z.uuid().optional(),
  versions: z.array(z.object({ assetId: z.uuid(), name: z.string().max(1000), createdAt: z.number(), settings: assetSettingsSchema })).max(1000),
}).refine(g => [g.settings, ...(g.submitted ? [g.submitted] : []), ...g.versions.map(v => v.settings)].every(settings => assetModel(settings.model)?.kind === g.kind), 'Generation model must match the asset type.')
  .refine(g => (!g.selectedAssetId || g.versions.some(v => v.assetId === g.selectedAssetId)) && new Set(g.versions.map(v => v.assetId)).size === g.versions.length, 'Invalid generation versions.');
export type AssetGeneration = z.infer<typeof assetGenerationSchema>;
export const generationBusy = (g: Pick<AssetGeneration, 'phase'>) => ['preparing', 'queued', 'rendering', 'loading'].includes(g.phase);
/** Explicit references first (an edit's base image stays first), then each selected character's images. */
export function characterReferences(settings: AssetSettings, characters: readonly ProjectCharacter[] | undefined): AssetReference[] {
  if (!assetModel(settings.model)?.inputs.includes('image')) return [];
  const seen = new Set(settings.references.map(ref => ref.assetId));
  return selectedCharacters(characters, settings.characterIds).flatMap(character => (character.images ?? []).flatMap((image, index, images) => {
    if (seen.has(image.assetId)) return []; seen.add(image.assetId);
    return [{ assetId: image.assetId, name: images.length > 1 ? `${character.name} ${index + 1}` : character.name, kind: 'image' as const }];
  }));
}
/** The settings actually submitted: selected characters' images join the references. */
export const withCharacterReferences = (settings: AssetSettings, characters: readonly ProjectCharacter[] | undefined): AssetSettings => {
  const added = characterReferences(settings, characters);
  return added.length ? { ...settings, references: [...settings.references, ...added] } : settings;
};
/** The characters enhancement should know: dialogue's speaker, or the selected characters plus any the prompt names. */
export function promptCharacters(settings: AssetSettings, characters: readonly ProjectCharacter[] | undefined) {
  const model = assetModel(settings.model);
  if (model?.audioType === 'dialogue') return characterContext(selectedCharacters(characters, settings.characterIds).slice(0, DIALOGUE_MAX_SPEAKERS), { voice: true, visual: true });
  const featured = featuredCharacters(settings.prompt, characters, settings.characterIds);
  if (model?.kind === 'audio') return characterContext(featured, { voice: true, visual: true });
  const images = withCharacterReferences(settings, characters).references.filter(ref => ref.kind === 'image');
  return characterContext(featured, { voice: false, visual: true, images: character => images.flatMap((ref, index) => character.images?.some(image => image.assetId === ref.assetId) ? [index + 1] : []) });
}
/** A synchronous request that was interrupted by a reload has no job to resume. */
export const interruptedGeneration = (g: Pick<AssetGeneration, 'phase' | 'requestId'>) => g.phase === 'preparing' || generationBusy(g) && !g.requestId;
export function newAssetGeneration(kind: MediaKind, folderId?: string, loras?: readonly ProjectLora[]): AssetGeneration {
  const model = ASSET_MODELS.find(m => m.kind === kind);
  if (!model) throw new Error('Video generation uses Comfy H3. Add a video clip on the timeline.');
  return { id: crypto.randomUUID(), name: `Untitled ${kind}`, kind, folderId, phase: 'draft', versions: [],
    settings: { model: model.id, lora: projectLoraAddress(loras, model.id), loraStrength: projectLoraStrength(loras, model.id), prompt: '', references: [], aspectRatio: '16:9', resolution: '1K', count: 1, duration: 5,
      ...(kind === 'audio' ? { autoDuration: true, stability: .5 as const, promptInfluence: .3 } : {}) } };
}
/** Settings for another audio model, keeping the prompt and clamping the duration to its limits. */
export function audioModelSettings(settings: AssetSettings, modelId: string): AssetSettings {
  const limits = AUDIO_DURATION_LIMITS[assetModel(modelId)?.audioType ?? 'dialogue'];
  return { ...settings, model: modelId, count: 1, ...(limits ? { duration: Math.min(limits.max, Math.max(limits.min, settings.duration)) } : {}) };
}
export function validateAssetSettings(settings: AssetSettings): string | undefined {
  const model = assetModel(settings.model);
  if (!model) return 'Choose a supported model.';
  if (model.kind === 'video') return 'Video generation uses Comfy H3. Use H3 for this clip.';
  if (settings.lora) return `${model.name} does not support LoRAs in the current generation integration. Choose None to generate.`;
  const promptError = promptSelectionError(settings);
  if (promptError) return promptError;
  if (!generationPrompt(settings).trim()) return 'Enter a prompt.';
  if (settings.references.some(ref => !model.inputs.includes(ref.kind))) return `${model.name} accepts ${model.inputs.join(', ') || 'no'} references. Remove incompatible inputs or choose another model.`;
  if (settings.references.filter(ref => ref.kind === 'image').length > model.maxImages) return `${model.name} accepts up to ${model.maxImages} images.`;
  if (['video', 'audio'].some(kind => settings.references.filter(ref => ref.kind === kind).length > 1)) return 'Use at most one video and one audio reference.';
  if (model.kind === 'image' && !model.resolutions.includes(settings.resolution)) return 'Choose a resolution supported by this model.';
  if (settings.count !== 1) return 'Generate one output at a time.';
  if (model.kind === 'audio') return validateAudioSettings(settings, model);
}
function validateAudioSettings(settings: AssetSettings, model: AssetModel): string | undefined {
  if (model.provider !== 'elevenlabs' || !model.audioType) return `${model.name} is no longer available. Choose an ElevenLabs dialogue, music or sound effects model.`;
  const prompt = generationPrompt(settings), limits = AUDIO_DURATION_LIMITS[model.audioType];
  if (limits && !settings.autoDuration && (settings.duration < limits.min || settings.duration > limits.max)) return `Choose a duration from ${limits.min} to ${limits.max} seconds, or Auto.`;
  if (model.audioType === 'sound-effects' && prompt.length > SOUND_EFFECT_PROMPT_MAX_LENGTH) return `Sound effect prompts can be up to ${SOUND_EFFECT_PROMPT_MAX_LENGTH} characters. Describe one sound, or split a sequence into separate clips.`;
  if (model.audioType !== 'dialogue') return;
  if ((settings.characterIds?.length ?? 0) > DIALOGUE_MAX_SPEAKERS) return 'Dialogue clips have one speaker. Choose one character.';
  return dialogueTextError(prompt, settings.dialogueVoices?.[0]?.speaker);
}
