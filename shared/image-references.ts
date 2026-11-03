import { z } from 'zod';

export const IMAGE_REFERENCE = { maxCount: 9, maxBytes: 1024 * 1024, maxInputBytes: 20 * 1024 * 1024, maxDimension: 1536 } as const;
export const imageReferencesSchema = z.array(z.object({ assetId: z.uuid(), name: z.string().min(1).max(1000) })).max(IMAGE_REFERENCE.maxCount);
export type ImageReference = z.infer<typeof imageReferencesSchema>[number];
export const imageReferenceIndexSchema = z.number().int().min(0).max(IMAGE_REFERENCE.maxCount - 1);
