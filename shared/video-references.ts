import { z } from 'zod';
export const videoAssetReferenceSchema = z.object({ kind: z.literal('image').optional(), assetId: z.uuid(), name: z.string().min(1).max(1000),
  inFrame: z.number().int().nonnegative(), outFrame: z.number().int().positive(),
}).refine(v => v.outFrame > v.inFrame, 'Video reference end must be after its start.');
export type VideoAssetReference = z.infer<typeof videoAssetReferenceSchema>;
export const videoReferenceSettings = {
  useStartVideoAsset: z.boolean().optional(), useEndVideoAsset: z.boolean().optional(),
  startVideoAsset: videoAssetReferenceSchema.optional(), endVideoAsset: videoAssetReferenceSchema.optional(),
  startVideoAssets: z.array(videoAssetReferenceSchema).max(16).optional(), endVideoAssets: z.array(videoAssetReferenceSchema).max(16).optional(),
};

/** Array settings take precedence, including an explicitly cleared selection. */
export function videoAssets(settings: { startVideoAsset?: VideoAssetReference; endVideoAsset?: VideoAssetReference; startVideoAssets?: VideoAssetReference[]; endVideoAssets?: VideoAssetReference[] }, side: 'start' | 'end'): VideoAssetReference[] {
  const clips = side === 'start' ? settings.startVideoAssets : settings.endVideoAssets;
  const legacy = side === 'start' ? settings.startVideoAsset : settings.endVideoAsset;
  return clips ?? (legacy ? [legacy] : []);
}
