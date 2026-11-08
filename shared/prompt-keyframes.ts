import { z } from 'zod';
import { COMFY } from './constants.js';
import { MAX_VIDEO_KEYFRAMES } from './video-keyframes.js';

export const promptKeyframesSchema = z.array(z.object({
  frame: z.number().int().min(0).max(COMFY.maxFrames - 1),
  image: z.string().max(32_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/),
})).max(MAX_VIDEO_KEYFRAMES);
export type PromptKeyframe = z.infer<typeof promptKeyframesSchema>[number];
