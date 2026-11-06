import { TIMELINE_FPS } from '../../../shared/constants';
import type { GenerationReference } from '../../../shared/interstitials';
import { referenceClips, referenceWindow } from '../../../shared/reference-clips';
import type { MaskSide } from '../../../shared/mask-curves';

/** Locate cuts in the exact reference windows used by the mask graph. */
export function maskVideoBoundaries(reference: GenerationReference | undefined, before: number, duration: number, after: number) {
  const boundaries: { side: MaskSide; time: number }[] = [];
  for (const side of ['before', 'after'] as const) {
    // Loop endings hold a single frame, even when the input spans several clips.
    if (side === 'after' && (reference?.mode === 'loop' || reference?.mode === 'extend')) continue;
    const frames = Math.round((side === 'before' ? before : after) * TIMELINE_FPS);
    const clips = referenceWindow(referenceClips(reference, side), frames, side);
    let elapsed = 0;
    for (const clip of clips.slice(0, -1)) {
      elapsed += clip.outFrame - clip.inFrame;
      boundaries.push({ side: side === 'before' ? 'start' : 'end',
        time: (side === 'before' ? 0 : before + duration) + elapsed / TIMELINE_FPS });
    }
  }
  return boundaries;
}
