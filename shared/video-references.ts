import { z } from 'zod';
import { COMFY } from './constants.js';
export const videoAssetReferenceSchema = z.object({ kind: z.enum(['image','audio']).optional(), assetId: z.uuid(), name: z.string().min(1).max(1000),
  inFrame: z.number().int().nonnegative(), outFrame: z.number().int().positive(),
}).refine(v => v.outFrame > v.inFrame, 'Video reference end must be after its start.');
export type VideoAssetReference = z.infer<typeof videoAssetReferenceSchema>;
/** Positions are relative to the generated section, matching image keyframes. */
export const timelineVideosSchema = z.array(z.object({
  id: z.string().min(1).max(200), frame: z.number().int().min(0).max(COMFY.maxFrames - 1),
  video: videoAssetReferenceSchema.optional(), enabled: z.boolean(),
  /** Level of this video's audio in the input. Absent is full volume. */
  volume: z.number().finite().min(0).max(1).optional(),
})).max(16).refine(values => new Set(values.map(value => value.id)).size === values.length, 'Video IDs must be unique.');
export type TimelineVideo = z.infer<typeof timelineVideosSchema>[number];
export function validateTimelineVideos(values: TimelineVideo[] = [], frames: number) {
  const sorted = timelineVideosSchema.parse(values).filter(value => value.enabled).sort((a, b) => a.frame - b.frame);
  let end = 0;
  for (const value of sorted) {
    if (!value.video) throw new Error('Choose a video for every enabled timeline clip.');
    if (value.video.kind) throw new Error('Timeline video inputs must be videos. Add still images as keyframes.');
    if (value.frame < end) throw new Error('Timeline videos overlap. Move or trim a clip.');
    end = value.frame + value.video.outFrame - value.video.inFrame;
    if (end > frames) throw new Error('A timeline video extends beyond the generated section. Trim it or increase Duration.');
  }
  return sorted;
}
export const videoReferenceSettings = {
  timelineVideos: timelineVideosSchema.optional(),
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
