import { ASSET_MODELS, type MediaKind } from './asset-generation.js';
import { H3_MODEL_ID } from './loras.js';

export type GenerationModel = { id: string; name: string; kind: MediaKind; supportsLora: boolean };
// The current fal endpoints expose no LoRA input. Keep their availability explicit
// instead of submitting an extra field that a provider may silently discard.
export const GENERATION_MODELS: GenerationModel[] = [
  { id: H3_MODEL_ID, name: 'H3', kind: 'video', supportsLora: true },
  ...ASSET_MODELS.map(({ id, name, kind }) => ({ id, name, kind, supportsLora: false })),
];
export const generationModel = (id: string) => GENERATION_MODELS.find(model => model.id === id);
