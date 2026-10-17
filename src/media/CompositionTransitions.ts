import { INTERSTITIAL_CROSSFADE_FRAMES } from '../../shared/constants';
import type { TimelineSegment } from './TimelineComposition';

export type CompositionTransition = { before: TimelineSegment; after: TimelineSegment; startFrame: number; endFrame: number };

/** Dissolves use surrounding asset handles and leave every timeline frame in place. */
export function compositionTransitions(segments: TimelineSegment[]): CompositionTransition[] {
  const transitions: CompositionTransition[] = [];
  for (let index = 1; index < segments.length; index++) {
    const before = segments[index - 1], after = segments[index];
    if (before.endFrame !== after.startFrame || before.kind !== 'interstitial' && after.kind !== 'interstitial') continue;
    // Half of each short clip is reserved for each edge, so neighboring fades cannot overlap.
    const half = Math.min(Math.floor(INTERSTITIAL_CROSSFADE_FRAMES / 2), Math.floor((before.endFrame - before.startFrame) / 2), Math.floor((after.endFrame - after.startFrame) / 2));
    if (half > 0) transitions.push({ before, after, startFrame: after.startFrame - half, endFrame: after.startFrame + half });
  }
  return transitions;
}

export const segmentTime = (segment: TimelineSegment, frame: number, fps: number) =>
  segment.sourceStart + (segment.still ? 0 : (frame - segment.startFrame) / fps);

export const transitionWeight = (transition: CompositionTransition, frame: number) =>
  Math.max(0, Math.min(1, (frame - transition.startFrame) / (transition.endFrame - transition.startFrame)));
