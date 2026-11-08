import { describe, expect, it } from 'vitest';
import { generationTimelineSegments } from '../../src/features/interstitials/generation-timeline';
import type { ClipReference, GenerationReference } from '../../shared/interstitials';

const clip = (assetId: string, inFrame: number, outFrame: number, kind?: 'image'): ClipReference => ({ sceneId: assetId, assetId, inFrame, outFrame, ...(kind ? { kind } : {}) });

describe('generation timeline reference windows', () => {
  it('fits reference sequences and preserves one-frame stills at the correct full-video positions', () => {
    const reference: GenerationReference = { mode: 'custom', beforeClips: [clip('video', 0, 96), clip('still', 0, 1, 'image')], afterClips: [clip('end-still', 0, 1, 'image'), clip('end-video', 24, 120)] };
    expect(generationTimelineSegments(reference, 39, 148, 39)).toEqual([
      { id: 'start:0:video', side: 'start', startFrame: 0, endFrame: 38, clip: clip('video', 58, 96) },
      { id: 'start:1:still', side: 'start', startFrame: 38, endFrame: 39, clip: clip('still', 0, 1, 'image') },
      { id: 'end:0:end-still', side: 'end', startFrame: 187, endFrame: 188, clip: clip('end-still', 0, 1, 'image') },
      { id: 'end:1:end-video', side: 'end', startFrame: 188, endFrame: 226, clip: clip('end-video', 24, 62) },
    ]);
  });
  it('shows the held last frame at the end of a loop instead of repeating its source sequence', () => {
    const reference: GenerationReference = { mode: 'loop', beforeClips: [clip('first', 0, 48), clip('last', 12, 60)], after: clip('last', 12, 60) };
    const segments = generationTimelineSegments(reference, 56, 80, 56);
    expect(segments.at(-1)).toEqual({ id: 'end:hold', side: 'end', startFrame: 136, endFrame: 192, held: true, clip: clip('last', 59, 60) });
    expect(segments.filter(segment => segment.side === 'end')).toHaveLength(1);
  });
  it('has no footage spans for image-only generation and represents unresolved footage without invented clips', () => {
    expect(generationTimelineSegments(undefined, 0, 158, 0)).toEqual([]);
    expect(generationTimelineSegments(undefined, 39, 148, 0)).toEqual([{ id: 'start:reference', side: 'start', startFrame: 0, endFrame: 39 }]);
  });
});
