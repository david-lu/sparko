import { z } from 'zod';
import { comfyLoraAssetId, isLoraFilename, loraAddressSchema } from '../../../shared/loras.js';
import { HttpError } from '../../shared/http.js';
import type { ComfyClient } from './client.js';

export const loraOptions = (node?: { input?: { required?: Record<string, unknown[]> } }): string[] | undefined => {
  const field = node?.input?.required?.lora_name;
  const values = Array.isArray(field?.[0]) ? field[0] : (field?.[1] as { options?: unknown } | undefined)?.options;
  return Array.isArray(values) && values.every(value => typeof value === 'string') ? values : undefined;
};

const assetSchema = z.object({ name: z.string(), loader_path: z.string().nullable().optional(), tags: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).optional(), user_metadata: z.record(z.string(), z.unknown()).optional() });
const isLora = (asset: z.infer<typeof assetSchema>) => !asset.tags.includes('missing') && asset.tags.some(tag => tag === 'loras' || tag === 'model_type:loras' || tag.startsWith('loras/'));
function assetFilename(asset: z.infer<typeof assetSchema>): string | undefined {
  // Cloud imports use repository-prefixed names, as in the animation repo.
  // Content-addressed asset records instead expose their loader path/metadata.
  const name = asset.loader_path ?? (isLoraFilename(asset.name) ? asset.name : asset.user_metadata?.filename ?? asset.metadata?.filename);
  return typeof name === 'string' && isLoraFilename(name) ? name : undefined;
}

/** Match the animation repo's exact imported filenames; never download a pasted URL. */
export async function resolveComfyLora(client: ComfyClient, value: string): Promise<string> {
  const address = loraAddressSchema.parse(value), assetId = comfyLoraAssetId(address);
  let filename = address;
  if (assetId) {
    const asset = assetSchema.parse(await client.call(`/api/assets/${encodeURIComponent(assetId)}`));
    if (!isLora(asset)) throw new HttpError(400, 'This Comfy asset is not a LoRA. Choose an available model from the LoRAs folder.');
    const name = assetFilename(asset);
    if (!name) throw new HttpError(400, 'This Comfy LoRA has no usable filename. Paste its imported .safetensors name.');
    filename = name;
  }
  const nodes = await client.call<Record<string, { input?: { required?: Record<string, unknown[]> } }>>('/api/object_info', { signal: AbortSignal.timeout(15_000) });
  if (!nodes.LoraLoaderModelOnly) throw new HttpError(503, 'Comfy Cloud is missing the LoRA loader.');
  const available = loraOptions(nodes.LoraLoaderModelOnly) ?? [];
  if (assetId || available.includes(filename)) return filename;
  // Private imports may be absent from object_info. The animation repo merges
  // the account's model assets with the built-in loader dropdowns as well.
  const matches = new Set(available.filter(name => name.endsWith(`__${filename}`)));
  let offset = 0;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = z.object({ assets: z.array(assetSchema), has_more: z.boolean() }).parse(await client.call(
      `/api/assets?include_tags=models&include_public=false&limit=100&offset=${offset}`, { signal: AbortSignal.timeout(15_000) }));
    for (const asset of page.assets) {
      if (!isLora(asset)) continue;
      const name = assetFilename(asset);
      if (name === filename) return name;
      if (name?.endsWith(`__${filename}`)) matches.add(name);
    }
    if (!page.has_more) {
      if (matches.size === 1) return [...matches][0];
      if (matches.size > 1) throw new HttpError(400, 'More than one imported LoRA matches. Paste its full Comfy Cloud model filename.');
      throw new HttpError(400, 'This LoRA is not available in your Comfy Cloud account. Import it there first, then paste its exact model filename.');
    }
    if (!page.assets.length) break;
    offset += page.assets.length;
  }
  throw new HttpError(502, 'Unable to finish checking the Comfy model library. Paste the model’s Comfy asset link or try again.');
}
