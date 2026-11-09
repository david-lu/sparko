import { z } from 'zod';
import { COMFY, TIMELINE_FPS } from './constants.js';
import { comfyBridgePlan } from './comfy.js';
import type { MaskCurve } from './mask-curves.js';

const referenceFrames = z.number().int().min(0).max(4 * TIMELINE_FPS).refine(frames => frames === 0
  || frames >= COMFY.minContextFrames && (frames - COMFY.firstFrames) % COMFY.frameGroup === 0, 'Use the encoded reference frame count.');
export const promptReferenceTimingSchema = z.object({ prefixFrames: referenceFrames, suffixFrames: referenceFrames });
export type PromptReferenceTiming = z.infer<typeof promptReferenceTimingSchema>;
export type PromptTimeline = { generatedStart: number; generatedEnd: number; generatedDuration: number; totalDuration: number };
export const promptReferenceDescriptionSchema = z.object({
  side: z.enum(['start', 'end']), frames: referenceFrames.refine(frames => frames > 0),
  description: z.string().trim().min(1).max(16_000),
});
export type PromptReferenceDescription = z.infer<typeof promptReferenceDescriptionSchema>;

export function promptReferenceContext(descriptions: PromptReferenceDescription[] | undefined, timeline?: PromptTimeline, audioMask?: MaskCurve) {
  if (!timeline) return;
  return descriptions?.map(({ side, frames, description }) => ({ side, description, duration: frames / TIMELINE_FPS,
    start: side === 'start' ? 0 : timeline.generatedEnd,
    end: side === 'start' ? timeline.generatedStart : timeline.totalDuration,
    audioRegenerationCurve: audioMask?.[side],
    timestampBasis: 'Description timestamps are seconds relative to the start of this reference segment, not the full video.',
  }));
}

/** Use the same padded render length and reference windows as the H3 generation graph. */
export function promptTimeline(duration: number, references: PromptReferenceTiming): PromptTimeline {
  const plan = comfyBridgePlan(references.prefixFrames / TIMELINE_FPS, references.suffixFrames / TIMELINE_FPS, duration, 'custom');
  return { generatedStart: plan.insertion.start, generatedEnd: (plan.totalFrames - plan.suffixFrames) / TIMELINE_FPS,
    generatedDuration: plan.insertion.duration, totalDuration: plan.insertion.totalDuration };
}

export const promptSeconds = (seconds: number) => Number(seconds.toFixed(3)).toString();
export function promptTimelineDirection(timeline: PromptTimeline): string {
  const { generatedStart: start, generatedEnd: end, totalDuration: total } = timeline;
  return `All timestamps are measured from the start of the full video. New actions and scripted dialogue belong only in the generated section, from ${promptSeconds(start)} to ${promptSeconds(end)} seconds.`
    + (start ? ` The opening reference footage and audio occupy 0 to ${promptSeconds(start)} seconds; do not start the new scripted actions or dialogue there.` : '')
    + (end < total ? ` The ending reference footage and audio occupy ${promptSeconds(end)} to ${promptSeconds(total)} seconds; finish all new dialogue before it starts.` : '')
    + (start || end < total ? ' Keep unmasked reference content intact; allow motion and sound to blend across regeneration masks.' : '')
    + (start || end < total ? ' Do not repeat reference dialogue in the generated section. Performance and silence directions below apply only to the generated section.' : '');
}
