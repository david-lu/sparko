import { z } from 'zod';
import { INTERSTITIAL, MASK_TRANSITION, TIMELINE_FPS } from './constants.js';
import { generationMethods, generationResolutions, maskInjections } from './interstitials.js';
import { imageReferencesSchema } from './image-references.js';

export const CLIP_METADATA_TAG = 'sparko';
export const MAX_CLIP_METADATA_BYTES = 256 * 1024;
const id = z.string().min(1).max(200);
const seconds = z.number().finite().nonnegative().max(1e8);
const frame = z.number().int().nonnegative().max(1e10);
const range = z.object({ inFrame: frame, outFrame: frame }).refine(v => v.outFrame > v.inFrame);
export const clipSettingsSchema = z.object({
  imageReferences: imageReferencesSchema.optional(),
  method: z.enum(generationMethods), resolution: z.enum(generationResolutions),
  start_range: seconds.max(4), end_range: seconds.max(4), duration: seconds.min(1).max(INTERSTITIAL.maxDuration),
  prompt: z.string().max(8000), enable_prompt_expansion: z.boolean(),
  useInputReference: z.boolean().optional(), useOutputReference: z.boolean().optional(),
  continuity: z.string().max(50_000).optional(), dialogue: z.string().max(50_000).optional(), loopAudio: z.boolean().optional(),
  maskInjection: z.enum(maskInjections), audioMaskTransitionMs: seconds.int().max(MASK_TRANSITION.maxMs),
  videoMaskTransitionMs: seconds.int().max(MASK_TRANSITION.maxMs),
});
const reference = z.object({ sceneId: id, assetId: id, name: z.string().max(1000), renderId: z.uuid().optional(),
  inFrame: frame, outFrame: frame }).refine(v => v.outFrame > v.inFrame);
export const clipOriginSchema = z.object({
  format: z.literal('sparko-clip'), version: z.literal(1), fps: z.literal(TIMELINE_FPS), id: z.uuid(),
  createdAt: z.iso.datetime(),
  clip: z.object({ nodeId: id.optional(), name: z.string().max(1000), time: seconds,
    loop: z.boolean(), conditional: z.boolean(), loopCount: frame.max(10_000), trim: range.optional(),
    conditions: z.array(z.object({ id, label: z.string().max(200), values: z.array(z.string().max(200)).max(100) })).max(100).optional(),
    defaultConditionId: id.optional(),
  }),
  settings: clipSettingsSchema,
  references: z.object({ mode: z.enum(['bridge', 'extend', 'loop', 'custom']).optional(), before: reference.optional(), after: reference.optional() }),
});
export const clipMetadataSchema = clipOriginSchema.extend({
  prompt: z.string().max(8000), jobId: id.optional(),
  media: z.object({ start: seconds, duration: seconds.positive(), totalDuration: seconds.positive() })
    .refine(v => v.start + v.duration <= v.totalDuration + 1 / TIMELINE_FPS),
}).refine(v => !v.clip.trim || v.clip.trim.outFrame <= Math.round(v.media.duration * v.fps), 'Clip trim exceeds its generated section.');
export type ClipOrigin = z.infer<typeof clipOriginSchema>;
export type ClipMetadata = z.infer<typeof clipMetadataSchema>;

export function parseClipMetadata(text: unknown): ClipMetadata | undefined {
  if (typeof text !== 'string' || text.length > MAX_CLIP_METADATA_BYTES) return;
  try {
    const result = clipMetadataSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : undefined;
  } catch { return; }
}
