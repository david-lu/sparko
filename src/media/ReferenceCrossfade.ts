import type { InsertionRange } from '../../shared/contracts';

type Clip = { frames: number; generated: boolean; range?: InsertionRange };

/** Relative to the cut. Generated content is never inside a dissolve window. */
export function referenceCrossfade(before: Clip, after: Clip, requestedFrames: number, fps: number) {
  // Adjacent generated bodies have no shared timeline interval outside both bodies.
  if (before.generated === after.generated) return;
  const generated = before.generated ? before : after, range = generated.range;
  if (!range || ![range.start, range.duration, range.totalDuration].every(Number.isFinite)
    || range.start < 0 || range.duration <= 0 || range.totalDuration < range.start + range.duration - 1e-6) return;
  const available = before.generated ? range.totalDuration - range.start - range.duration : range.start;
  const frames = Math.max(0, Math.min(Math.floor(requestedFrames), Math.floor(available * fps + 1e-6),
    before.generated ? after.frames : before.frames));
  if (!frames) return;
  return { startFrame: before.generated ? 0 : -frames, frames };
}
