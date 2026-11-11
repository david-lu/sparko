import { z } from 'zod';

export const IMAGE_REFERENCE = { maxCount: 9, maxBytes: 1024 * 1024, maxInputBytes: 20 * 1024 * 1024, maxDimension: 1536 } as const;
/** characterId marks pictures added from a project character, so prompts can name who they show. */
export const imageReferencesSchema = z.array(z.object({ assetId: z.uuid(), name: z.string().min(1).max(1000), enabled: z.boolean().optional(), characterId: z.uuid().optional() })).max(IMAGE_REFERENCE.maxCount);
export type ImageReference = z.infer<typeof imageReferencesSchema>[number];
export const imageReferenceIndexSchema = z.number().int().min(0).max(IMAGE_REFERENCE.maxCount - 1);

/** Keep saved Picture numbers stable; compact only the submitted active inputs. */
export function enabledImageReferences<T extends { imageReferences?: ImageReference[]; startImageIndex?: number; endImageIndex?: number; prompt: string }>(item: T): T {
  const refs = item.imageReferences ?? [], indexes = new Map<number, number>();
  const imageReferences = refs.filter((image, index) => {
    if (image.enabled === false) return false;
    indexes.set(index, indexes.size); return true;
  });
  const prompt = item.prompt.replace(/<Picture\s+(\d+)>/g, (tag, number) => {
    const index = Number(number) - 1;
    if (refs[index]?.enabled === false) throw new Error(`The prompt uses disabled Picture ${number}. Enable it or remove that reference from the prompt.`);
    return indexes.has(index) ? `<Picture ${indexes.get(index)! + 1}>` : tag;
  });
  return { ...item, prompt, imageReferences, startImageIndex: item.startImageIndex === undefined ? undefined : indexes.get(item.startImageIndex), endImageIndex: item.endImageIndex === undefined ? undefined : indexes.get(item.endImageIndex) };
}
