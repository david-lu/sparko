import { z } from 'zod';

export const H3_MODEL_ID = 'h3';

/** Accept asset links only. Provider credentials must never be sent to a pasted URL. */
export function comfyLoraAssetId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://cloud.comfy.org' || url.username || url.password || url.search || url.hash) return;
    return /^\/api\/(?:v2\/)?assets\/([A-Za-z0-9_-]{8,128})(?:\/content)?\/?$/.exec(url.pathname)?.[1];
  } catch { return; }
}
export const isLoraFilename = (value: string) => value.length <= 1000 && !value.startsWith('/') && !value.split('/').some(part => !part || part === '.' || part === '..') && !/[\\:?#\x00-\x1f\x7f]/.test(value) && value.toLowerCase().endsWith('.safetensors');
export const loraAddressSchema = z.string().trim().max(2000).refine(value => isLoraFilename(value) || !!comfyLoraAssetId(value), 'Enter an imported Comfy LoRA filename (.safetensors) or a Comfy Cloud model asset link.');
export const LORA_INSTRUCTIONS_MAX_LENGTH = 4000;
export const loraInstructionsSchema = z.string().trim().max(LORA_INSTRUCTIONS_MAX_LENGTH);
// Match Comfy's LoraLoaderModelOnly input; older projects used a fixed strength of 1.
export const LORA_STRENGTH = { default: 1, min: -100, max: 100, step: 0.01 };
export const loraStrengthSchema = z.number().finite().min(LORA_STRENGTH.min).max(LORA_STRENGTH.max);
export const loraSettings = { lora: loraAddressSchema.nullable().optional(), loraInstructions: loraInstructionsSchema.optional(), loraStrength: loraStrengthSchema.optional() };
export const projectLoraSchema = z.object({ model: z.string().min(1).max(100), address: loraAddressSchema, name: z.string().min(1).max(1000), instructions: loraInstructionsSchema.optional(), strength: loraStrengthSchema.optional() });
export const projectLorasSchema = z.array(projectLoraSchema).max(100)
  .refine(loras => new Set(loras.map(lora => lora.model)).size === loras.length, 'Only one LoRA is allowed per model.');
export type ProjectLora = z.infer<typeof projectLoraSchema>;
export const projectLoraAddress = (loras: readonly ProjectLora[] | undefined, model: string): string | null => loras?.find(lora => lora.model === model)?.address ?? null;
export const projectLoraStrength = (loras: readonly ProjectLora[] | undefined, model: string): number => loras?.find(lora => lora.model === model)?.strength ?? LORA_STRENGTH.default;

/** Custom instructions override the matching project assignment; None never supplies instructions. */
export function generationLoraInstructions(settings: { lora?: string | null; loraInstructions?: string }, loras: readonly ProjectLora[] | undefined, model: string): string | undefined {
  if (!settings.lora) return;
  return (settings.loraInstructions ?? loras?.find(lora => lora.model === model && lora.address === settings.lora)?.instructions)?.trim() || undefined;
}

export function saveProjectLora(loras: readonly ProjectLora[] = [], entry: ProjectLora, previousModel?: string): ProjectLora[] {
  const parsed = projectLoraSchema.parse(entry);
  if (previousModel && !loras.some(lora => lora.model === previousModel)) throw new Error('This assignment was removed. Add the LoRA again.');
  if (loras.some(lora => lora.model === parsed.model && lora.model !== previousModel)) throw new Error('This model already has a LoRA. Edit its existing assignment.');
  return projectLorasSchema.parse(previousModel
    ? loras.map(lora => lora.model === previousModel ? parsed : lora)
    : [...loras, parsed]);
}
