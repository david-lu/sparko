import { enhancedPromptSettings, generationPrompt, promptSelectionError } from './prompt-versions.js';
import { z } from 'zod';
import { loraSettings, projectLoraAddress, projectLoraStrength, type ProjectLora } from './loras.js';

export type MediaKind = 'image' | 'video' | 'audio';
export type AssetModel = { id: string; name: string; kind: MediaKind; endpoint: string; editEndpoint?: string; inputs: MediaKind[]; maxImages: number; resolutions: string[] };
export const ASSET_MODELS: AssetModel[] = [
  { id: 'nano-banana-2', name: 'Nano Banana 2', kind: 'image', endpoint: 'fal-ai/nano-banana-2', editEndpoint: 'fal-ai/nano-banana-2/edit', inputs: ['image', 'video', 'audio'], maxImages: 14, resolutions: ['1K', '2K', '4K'] },
  { id: 'flux-2-pro', name: 'FLUX.2 Pro', kind: 'image', endpoint: 'fal-ai/flux-2-pro', editEndpoint: 'fal-ai/flux-2-pro/edit', inputs: ['image'], maxImages: 9, resolutions: ['1K', '2K'] },
  { id: 'seedream-4.5', name: 'Seedream 4.5', kind: 'image', endpoint: 'fal-ai/bytedance/seedream/v4.5/text-to-image', editEndpoint: 'fal-ai/bytedance/seedream/v4.5/edit', inputs: ['image'], maxImages: 10, resolutions: ['2K', '4K'] },
  { id: 'nano-banana-pro', name: 'Nano Banana Pro', kind: 'image', endpoint: 'fal-ai/nano-banana-pro', editEndpoint: 'fal-ai/nano-banana-pro/edit', inputs: ['image'], maxImages: 14, resolutions: ['1K', '2K', '4K'] },
  { id: 'flux-2-max', name: 'FLUX.2 Max', kind: 'image', endpoint: 'fal-ai/flux-2-max', editEndpoint: 'fal-ai/flux-2-max/edit', inputs: ['image'], maxImages: 8, resolutions: ['1K', '2K'] },
  { id: 'ideogram-v3', name: 'Ideogram 3.0', kind: 'image', endpoint: 'fal-ai/ideogram/v3', inputs: [], maxImages: 0, resolutions: ['1K'] },
  { id: 'sound-effects', name: 'ElevenLabs Sound Effects', kind: 'audio', endpoint: 'fal-ai/elevenlabs/sound-effects/v2', inputs: [], maxImages: 0, resolutions: [] },
  { id: 'stable-audio-2.5', name: 'Stable Audio 2.5 · Music & sound', kind: 'audio', endpoint: 'fal-ai/stable-audio-25/text-to-audio', editEndpoint: 'fal-ai/stable-audio-25/audio-to-audio', inputs: ['audio'], maxImages: 0, resolutions: [] },
];
// Retain names and queue paths for saved projects and already-submitted jobs.
const legacyModels: AssetModel[] = [{ id: 'kling-video', name: 'Kling 2.6 Pro', kind: 'video', endpoint: 'fal-ai/kling-video/v2.6/pro/text-to-video', inputs: ['image'], maxImages: 1, resolutions: [] }];
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
  count: z.number().int().min(1).max(4), duration: z.number().min(.5).max(190),
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
export function newAssetGeneration(kind: MediaKind, folderId?: string, loras?: readonly ProjectLora[]): AssetGeneration {
  const model = ASSET_MODELS.find(m => m.kind === kind);
  if (!model) throw new Error('Video generation uses Comfy H3. Add a video clip on the timeline.');
  return { id: crypto.randomUUID(), name: `Untitled ${kind}`, kind, folderId, phase: 'draft', versions: [],
    settings: { model: model.id, lora: projectLoraAddress(loras, model.id), loraStrength: projectLoraStrength(loras, model.id), prompt: '', references: [], aspectRatio: '16:9', resolution: '1K', count: 1, duration: 5 } };
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
  if (model.id === 'sound-effects' && settings.duration > 22) return 'Sound effects can be up to 22 seconds.';
  if (model.id === 'stable-audio-2.5' && !Number.isInteger(settings.duration)) return 'Choose a whole number of seconds for Stable Audio.';
  if (settings.count !== 1) return 'Generate one output at a time.';
}
