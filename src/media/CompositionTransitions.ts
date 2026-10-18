import { INTERSTITIAL_CROSSFADE_FRAMES, TIMELINE_FPS } from '../../shared/constants';
import type { TimelineSegment } from './TimelineComposition';
import { referenceCrossfade } from './ReferenceCrossfade';

export type CompositionTransition = { before: TimelineSegment; after: TimelineSegment; startFrame: number; endFrame: number };

/** Dissolves occupy reference footage on the source side of each generated body. */
export function compositionTransitions(segments: TimelineSegment[], frames = INTERSTITIAL_CROSSFADE_FRAMES, fps = TIMELINE_FPS): CompositionTransition[] {
  const transitions: CompositionTransition[] = [];
  for (let index = 1; index < segments.length; index++) {
    const before = segments[index - 1], after = segments[index];
    if (before.endFrame !== after.startFrame || before.kind !== 'interstitial' && after.kind !== 'interstitial') continue;
    const window = referenceCrossfade(
      { frames: before.endFrame - before.startFrame, generated: before.kind === 'interstitial', range: before.generated },
      { frames: after.endFrame - after.startFrame, generated: after.kind === 'interstitial', range: after.generated }, frames, fps);
    if (window) transitions.push({ before, after, startFrame: after.startFrame + window.startFrame, endFrame: after.startFrame + window.startFrame + window.frames });
  }
  // A short source interval between inserts must still use at most two decks.
  for (let index = 1; index < transitions.length; index++) {
    const previous = transitions[index - 1], next = transitions[index];
    if (previous.endFrame <= next.startFrame) continue;
    const boundary = Math.floor((previous.startFrame + next.endFrame) / 2);
    previous.endFrame = boundary; next.startFrame = boundary;
  }
  return transitions.filter(transition => transition.endFrame > transition.startFrame);
}

export const segmentTime = (segment: TimelineSegment, frame: number, fps: number) =>
  segment.still ? segment.sourceStart : segment.generated && frame >= segment.endFrame
    ? segment.generated.start + segment.generated.duration + (frame - segment.endFrame) / fps
    : segment.sourceStart + (frame - segment.startFrame) / fps;

export const transitionWeight = (transition: CompositionTransition, frame: number) =>
  Math.max(0, Math.min(1, (frame - transition.startFrame) / (transition.endFrame - transition.startFrame)));
