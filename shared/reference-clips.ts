import type { ClipReference, GenerationReference } from './interstitials';

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
