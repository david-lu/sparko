import { TIMELINE_FPS } from '../../../shared/constants';
import type { ClipReference, GenerationReference } from '../../../shared/interstitials';
import { referenceClips, referenceWindow } from '../../../shared/reference-clips';

export type GenerationSegment = {
  id: string; side: 'start' | 'end'; startFrame: number; endFrame: number; clip?: ClipReference; held?: boolean;
};
/** Use the same fitted windows as the generation export, including single-frame stills and loop holds. */
export function generationTimelineSegments(reference: GenerationReference | undefined, prefixFrames: number, middleFrames: number, suffixFrames: number): GenerationSegment[] {
  return (['start', 'end'] as const).flatMap(side => {
    const frames = side === 'start' ? prefixFrames : suffixFrames, offset = side === 'start' ? 0 : prefixFrames + middleFrames;
    if (!frames) return [];
    const held = side === 'end' && (reference?.mode === 'loop' || reference?.mode === 'extend');
    if (held) {
      const source = referenceClips(reference, 'before').at(-1);
      return [{ id: `${side}:hold`, side, startFrame: offset, endFrame: offset + frames, held: true,
        clip: source && { ...source, inFrame: source.outFrame - 1 } }];
    }
    const clips = referenceWindow(referenceClips(reference, side === 'start' ? 'before' : 'after'), frames, side === 'start' ? 'before' : 'after');
    if (!clips.length) return [{ id: `${side}:reference`, side, startFrame: offset, endFrame: offset + frames }];
    let cursor = offset;
    return clips.map((clip, index) => {
      const startFrame = cursor; cursor += clip.outFrame - clip.inFrame;
      return { id: `${side}:${index}:${clip.assetId}`, side, clip, startFrame, endFrame: cursor };
    });
  });
}
export const timelineSeconds = (frame: number) => Number((frame / TIMELINE_FPS).toFixed(3));
