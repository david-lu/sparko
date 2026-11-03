import { z } from 'zod';
export const videoAssetReferenceSchema = z.object({ assetId: z.uuid(), name: z.string().min(1).max(1000),
  inFrame: z.number().int().nonnegative(), outFrame: z.number().int().positive(),
}).refine(v => v.outFrame > v.inFrame, 'Video reference end must be after its start.');
export type VideoAssetReference = z.infer<typeof videoAssetReferenceSchema>;
export const videoReferenceSettings = {
  useStartVideoAsset: z.boolean().optional(), useEndVideoAsset: z.boolean().optional(),
  startVideoAsset: videoAssetReferenceSchema.optional(), endVideoAsset: videoAssetReferenceSchema.optional(),
};
