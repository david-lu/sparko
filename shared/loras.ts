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
export const loraSettings = { lora: loraAddressSchema.nullable().optional() };
export const projectLoraSchema = z.object({ model: z.string().min(1).max(100), address: loraAddressSchema, name: z.string().min(1).max(1000) });
export const projectLorasSchema = z.array(projectLoraSchema).max(100)
  .refine(loras => new Set(loras.map(lora => lora.model)).size === loras.length, 'Only one LoRA is allowed per model.');
export type ProjectLora = z.infer<typeof projectLoraSchema>;
export const projectLoraAddress = (loras: readonly ProjectLora[] | undefined, model: string): string | null => loras?.find(lora => lora.model === model)?.address ?? null;

export function saveProjectLora(loras: readonly ProjectLora[] = [], entry: ProjectLora, previousModel?: string): ProjectLora[] {
  const parsed = projectLoraSchema.parse(entry);
  if (previousModel && !loras.some(lora => lora.model === previousModel)) throw new Error('This assignment was removed. Add the LoRA again.');
  if (loras.some(lora => lora.model === parsed.model && lora.model !== previousModel)) throw new Error('This model already has a LoRA. Edit its existing assignment.');
  return projectLorasSchema.parse(previousModel
    ? loras.map(lora => lora.model === previousModel ? parsed : lora)
    : [...loras, parsed]);
}
