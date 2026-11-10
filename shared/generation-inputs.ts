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
/** Spans of the full render clock where the input movie has audible sound. */
export const inputAudioContentSchema = z.array(inputRange).max(1024);
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
/** A content span on the full render clock: [frame, frame + frames). */
export const rangesContain = (ranges: TimelineInputRange[], frame: number) => ranges.some(range => frame >= range.frame && frame < range.frame + range.frames);
/** Sorted spans with touching or overlapping spans joined. */
export function mergeRanges(ranges: TimelineInputRange[]): TimelineInputRange[] {
  const merged: TimelineInputRange[] = [];
  for (const range of ranges.filter(range => range.frames > 0).sort((a, b) => a.frame - b.frame)) {
    const last = merged.at(-1);
    if (last && range.frame <= last.frame + last.frames) last.frames = Math.max(last.frames, range.frame + range.frames - last.frame);
    else merged.push({ ...range });
  }
  return merged;
}
/** Spans of [0, frames) with no input content. */
export function contentGaps(content: TimelineInputRange[], frames: number): TimelineInputRange[] {
  const gaps: TimelineInputRange[] = [];
  let cursor = 0;
  for (const range of mergeRanges(content)) {
    if (range.frame > cursor) gaps.push({ frame: cursor, frames: Math.min(frames, range.frame) - cursor });
    cursor = Math.max(cursor, range.frame + range.frames);
  }
  if (cursor < frames) gaps.push({ frame: cursor, frames: frames - cursor });
  return gaps.filter(gap => gap.frames > 0);
}
/** Both references plus generated-section spans (relative to the section), on the full render clock.
 * Reference picture is always input content; requests without explicit audio content treat reference sound the same way. */
export function referenceContent(prefix: number, middle: number, suffix: number, ranges: TimelineInputRange[]): TimelineInputRange[] {
  return mergeRanges([...prefix ? [{ frame: 0, frames: prefix }] : [], ...ranges.map(range => ({ frame: prefix + range.frame, frames: range.frames })),
    ...suffix ? [{ frame: prefix + middle, frames: suffix }] : []]);
}
export function validateContentRanges(ranges: TimelineInputRange[], frames: number) {
  let end = 0;
  for (const range of inputAudioContentSchema.parse(ranges)) {
    if (range.frame < end || range.frame + range.frames > frames) throw new Error('Input audio spans must be ordered inside the render without overlapping.');
    end = range.frame + range.frames;
  }
}
const keep = [{ position: 0, strength: 0 }, { position: 1, strength: 0 }];
/** The generated section keeps whatever input it has by default; spans without input regenerate regardless. */
export function inputMaskCurve(curve: MaskCurve | undefined, before: number, after: number, milliseconds: number): MaskCurve {
  const value = curve ?? defaultMaskCurve(before, after, milliseconds);
  return value.body ? value : { ...value, body: keep };
}
/** Spans without input content always regenerate. A preserved image keeps its frame, video only. */
export function inputMaskStrength(curve: MaskCurve, frame: number, prefix: number, middle: number, suffix: number,
  content: TimelineInputRange[], preservedFrames: number[] = []): number {
  if (preservedFrames.includes(Math.floor(frame - prefix + 1e-6))) return 0;
  if (!rangesContain(content, frame)) return 1;
  return maskStrength(curve, frame / TIMELINE_FPS, prefix / TIMELINE_FPS, middle / TIMELINE_FPS, suffix / TIMELINE_FPS);
}

/** One H3 audio latent column, as [start, end] frames on the full render clock. */
export const audioColumn = (index: number) => [index / COMFY.audioLatentsPerSecond * TIMELINE_FPS, (index + 1) / COMFY.audioLatentsPerSecond * TIMELINE_FPS];
/** Columns touching a seam between a reference and the generated section always regenerate,
 * even where added sound or a timeline video keeps the audio beside it. Rounds outward. */
export function audioSeamColumn(index: number, prefix: number, middle: number, suffix: number) {
  const [a, b] = audioColumn(index), end = prefix + middle;
  return prefix > 0 && a <= prefix && prefix <= b || suffix > 0 && a <= end && end <= b;
}
/** The audio mask H3 receives, one strength per audio latent column. */
export function audioMaskColumns(curve: MaskCurve, prefix: number, middle: number, suffix: number, content: TimelineInputRange[]) {
  return Array.from({ length: Math.floor((prefix + middle + suffix) / TIMELINE_FPS * COMFY.audioLatentsPerSecond) }, (_, index) => {
    if (audioSeamColumn(index, prefix, middle, suffix)) return 1;
    // Any column straddling a span without sound must generate completely.
    const [a, b] = audioColumn(index);
    return Number(Math.max(inputMaskStrength(curve, a, prefix, middle, suffix, content), inputMaskStrength(curve, b - 1e-6, prefix, middle, suffix, content)).toFixed(6));
  });
}
/** The audio mask as drawn on the generation timeline, including regenerated seams. */
export function inputAudioMaskStrength(curve: MaskCurve, frame: number, prefix: number, middle: number, suffix: number, content: TimelineInputRange[]) {
  return audioSeamColumn(Math.floor(frame / TIMELINE_FPS * COMFY.audioLatentsPerSecond), prefix, middle, suffix) ? 1
    : inputMaskStrength(curve, frame, prefix, middle, suffix, content);
}
