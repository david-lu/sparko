import { z } from 'zod';
import { COMFY, TIMELINE_FPS } from './constants.js';
import { defaultMaskCurve, maskStrength, type MaskCurve } from './mask-curves.js';

const inputRange = z.object({
  frame: z.number().int().nonnegative().max(COMFY.maxFrames - 1),
  frames: z.number().int().positive().max(COMFY.maxFrames),
});
export const timelineInputRangesSchema = z.array(inputRange).max(16);
/** Merged spans of added input sound. They keep input audio, never input video. */
export const timelineAudioRangesSchema = z.array(inputRange).max(512);
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
export function validateInputRanges(ranges: TimelineInputRange[], frames: number, audio = false) {
  let end = 0;
  for (const range of [...(audio ? timelineAudioRangesSchema : timelineInputRangesSchema).parse(ranges)].sort((a, b) => a.frame - b.frame)) {
    if (range.frame < end || range.frame + range.frames > frames) throw new Error(`${audio ? 'Input audio spans' : 'Timeline videos'} must fit inside the generated section without overlapping.`);
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

/** One H3 audio latent column, as [start, end] frames on the full render clock. */
const audioColumn = (index: number) => [index / COMFY.audioLatentsPerSecond * TIMELINE_FPS, (index + 1) / COMFY.audioLatentsPerSecond * TIMELINE_FPS];
/** Columns touching a seam between a reference and the generated section always regenerate,
 * even where added sound or a timeline video keeps the audio beside it. Rounds outward. */
export function audioSeamColumn(index: number, prefix: number, middle: number, suffix: number) {
  const [a, b] = audioColumn(index), end = prefix + middle;
  return prefix > 0 && a <= prefix && prefix <= b || suffix > 0 && a <= end && end <= b;
}
/** The audio mask H3 receives, one strength per audio latent column. */
export function audioMaskColumns(curve: MaskCurve, prefix: number, middle: number, suffix: number, ranges: TimelineInputRange[]) {
  return Array.from({ length: Math.floor((prefix + middle + suffix) / TIMELINE_FPS * COMFY.audioLatentsPerSecond) }, (_, index) => {
    if (audioSeamColumn(index, prefix, middle, suffix)) return 1;
    // Any column straddling a blank region must generate completely.
    const [a, b] = audioColumn(index);
    return Number(Math.max(inputMaskStrength(curve, a, prefix, middle, suffix, ranges), inputMaskStrength(curve, b - 1e-6, prefix, middle, suffix, ranges)).toFixed(6));
  });
}
/** The audio mask as drawn on the generation timeline, including regenerated seams. */
export function inputAudioMaskStrength(curve: MaskCurve, frame: number, prefix: number, middle: number, suffix: number, ranges: TimelineInputRange[]) {
  return audioSeamColumn(Math.floor(frame / TIMELINE_FPS * COMFY.audioLatentsPerSecond), prefix, middle, suffix) ? 1
    : inputMaskStrength(curve, frame, prefix, middle, suffix, ranges);
}
