import { z } from 'zod';
import { COMFY, TIMELINE_FPS } from './constants.js';
import { imageReferencesSchema } from './image-references.js';

export const MAX_VIDEO_KEYFRAMES = 9;
export const videoKeyframesSchema = z.array(z.object({
  id: z.string().min(1).max(200),
  /** Relative to the generated body, so changing reference lengths does not move the requested action. */
  frame: z.number().int().min(0).max(COMFY.maxFrames - 1),
  image: imageReferencesSchema.element.optional(),
  enabled: z.boolean(),
})).max(MAX_VIDEO_KEYFRAMES).refine(values => new Set(values.map(value => value.id)).size === values.length, 'Keyframe IDs must be unique.');
export type VideoKeyframe = z.infer<typeof videoKeyframesSchema>[number];
export const videoKeyframeInputsSchema = z.array(z.object({
  frame: z.number().int().min(0).max(COMFY.maxFrames - 1),
  imageIndex: z.number().int().min(0).max(MAX_VIDEO_KEYFRAMES - 1),
})).max(MAX_VIDEO_KEYFRAMES);
export type VideoKeyframeInput = z.infer<typeof videoKeyframeInputsSchema>[number];

export function activeVideoKeyframes(values: VideoKeyframe[] = []) { return values.filter(value => value.enabled).sort((a, b) => a.frame - b.frame); }
export function validateVideoKeyframeInputs(values: VideoKeyframeInput[], middleFrames: number, imageCount: number, startImage = false, endImage = false) {
  videoKeyframeInputsSchema.parse(values);
  const frames = new Set<number>();
  for (const value of values) {
    if (value.imageIndex >= imageCount) throw new Error('Choose an image for every enabled keyframe.');
    if (value.frame >= middleFrames) throw new Error(`A keyframe is outside the generated section. Set its time to ${(Math.max(0, middleFrames - 1) / TIMELINE_FPS).toFixed(3)} seconds or earlier, or increase Duration.`);
    if (frames.has(value.frame)) throw new Error('Two enabled keyframes use the same frame. Move or disable one of them.');
    if (value.frame === 0 && startImage || value.frame === middleFrames - 1 && endImage) throw new Error('A keyframe overlaps the Start or End image. Move the keyframe or remove the endpoint image.');
    frames.add(value.frame);
  }
}
export function validateVideoKeyframes(values: VideoKeyframe[] | undefined, middleFrames: number, startImage = false, endImage = false) {
  const active = activeVideoKeyframes(videoKeyframesSchema.parse(values ?? []));
  if (active.some(value => !value.image)) throw new Error('Choose an image for every enabled keyframe.');
  validateVideoKeyframeInputs(active.map((value, imageIndex) => ({ frame: value.frame, imageIndex })), middleFrames, active.length, startImage, endImage);
}
