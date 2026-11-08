import type { ClipReference, GenerationReference, Interstitial } from './interstitials';
import { TIMELINE_FPS } from './constants';

export function referenceTiming(item: Pick<Interstitial, 'start_range' | 'end_range'>, input: GenerationReference) {
  const length = (side: 'before' | 'after') => referenceClips(input, side).reduce((sum, clip) => sum + clip.outFrame - clip.inFrame, 0);
  const before = Math.min(length('before'), Math.ceil(item.start_range * TIMELINE_FPS));
  const after = input.mode === 'loop' && !input.before && !input.after || input.mode === 'extend' || input.mode === 'custom' && !input.after ? 0
    : Math.min(input.after && input.mode !== 'loop' ? length('after') : Infinity, Math.ceil((input.mode === 'loop' ? item.start_range : item.end_range) * TIMELINE_FPS));
  return { before, after, time: before / TIMELINE_FPS, duration: (before + after) / TIMELINE_FPS };
}

/** References are ordered in playback order; the legacy fields identify the cut. */
export function referenceClips<T extends ClipReference>(input: { before?: T; after?: T; beforeClips?: T[]; afterClips?: T[] } | undefined, side: 'before' | 'after'): T[] {
  if (!input) return [];
  return input[side === 'before' ? 'beforeClips' : 'afterClips'] ?? (input[side] ? [input[side]!] : []);
}

export function referenceWindow(clips: ClipReference[], frames: number, side: 'before' | 'after'): ClipReference[] {
  const selected: ClipReference[] = [];
  let remaining = Math.max(0, frames);
  for (const clip of side === 'before' ? [...clips].reverse() : clips) {
    const count = Math.min(remaining, clip.outFrame - clip.inFrame);
    if (count <= 0) break;
    selected.push({ ...clip, ...(side === 'before' ? { inFrame: clip.outFrame - count } : { outFrame: clip.inFrame + count }) });
    remaining -= count;
  }
  return side === 'before' ? selected.reverse() : selected;
}

export function setReferenceClips(input: GenerationReference, side: 'before' | 'after', clips: ClipReference[]) {
  input[side] = side === 'before' ? clips.at(-1) : clips[0];
  input[side === 'before' ? 'beforeClips' : 'afterClips'] = clips.length > 1 ? clips : undefined;
}
