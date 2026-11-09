import { z } from 'zod';
import { COMFY, TIMELINE_FPS } from './constants.js';
import { defaultMaskCurve, maskStrength, type MaskCurve } from './mask-curves.js';

export const timelineInputRangesSchema = z.array(z.object({
  frame: z.number().int().nonnegative().max(COMFY.maxFrames - 1),
  frames: z.number().int().positive().max(COMFY.maxFrames),
})).max(16);
export type TimelineInputRange = z.infer<typeof timelineInputRangesSchema>[number];
/** Native H3 temporal mask cells, on the full render clock. */
export function h3MaskGroups(frames: number) {
  const groups: { start: number; end: number }[] = [];
  for (let start = 0, index = 0; start < frames; index++) {
    const end = Math.min(frames, start + (index % 5 === 0 ? 1 : 4));
    groups.push({ start, end }); start = end;
  }
  return groups;
}
export function validateInputRanges(ranges: TimelineInputRange[], frames: number) {
  let end = 0;
  for (const range of [...timelineInputRangesSchema.parse(ranges)].sort((a, b) => a.frame - b.frame)) {
    if (range.frame < end || range.frame + range.frames > frames) throw new Error('Timeline videos must fit inside the generated section without overlapping.');
    end = range.frame + range.frames;
  }
}
export function inputMaskCurve(curve: MaskCurve | undefined, before: number, after: number, milliseconds: number, hasVideos: boolean): MaskCurve {
  const value = curve ?? defaultMaskCurve(before, after, milliseconds);
  return hasVideos && !value.body ? { ...value, body: [{ position: 0, strength: 0 }, { position: 1, strength: 0 }] } : value;
}
/** Empty regions always generate. A preserved image affects video only, never audio. */
export function inputMaskStrength(curve: MaskCurve, frame: number, prefix: number, middle: number, suffix: number,
  ranges: TimelineInputRange[], preservedFrames: number[] = []): number {
  const bodyFrame = frame - prefix;
  if (preservedFrames.includes(Math.floor(bodyFrame + 1e-6))) return 0;
  if (bodyFrame >= 0 && bodyFrame < middle && !ranges.some(range => bodyFrame >= range.frame && bodyFrame < range.frame + range.frames)) return 1;
  return maskStrength(curve, frame / TIMELINE_FPS, prefix / TIMELINE_FPS, middle / TIMELINE_FPS, suffix / TIMELINE_FPS);
}
