import { z } from 'zod';

export const currentFrameSchema = z.string().max(32_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/).optional();
export const currentFrameInstructions = 'The current player frame shows the scene visible when enhancement was requested. Use it to ground relevant visible subjects, actions, setting and composition while preserving the requested changes. It is scene context only, not a numbered generation reference or a first/last-frame constraint. Do not assign it an Image or Picture number, claim it is supplied to generation, or infer unseen events from this single frame.';

export function currentFrameContent(currentFrame?: string) {
  return currentFrame ? [
    { type: 'input_text' as const, text: 'Current player frame (scene context only):' },
    { type: 'input_image' as const, image_url: currentFrame, detail: 'low' as const },
  ] : [];
}
