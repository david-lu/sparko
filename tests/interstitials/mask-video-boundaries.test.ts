import { describe, expect, it } from 'vitest';
import type { ClipReference, GenerationReference } from '../../shared/interstitials';
import { maskVideoBoundaries } from '../../src/features/interstitials/mask-video-boundaries';

const clip = (sceneId: string, inFrame: number, outFrame: number): ClipReference => ({ sceneId, assetId: sceneId, inFrame, outFrame });
const reference: GenerationReference = {
  beforeClips: [clip('earlier', 24, 72), clip('previous', 48, 96)],
  afterClips: [clip('following', 24, 48), clip('later', 48, 120)],
};

describe('mask video boundaries', () => {
  it('crops the start tail and end head to the planned frame counts and offsets end cuts past generation', () => {
    // A requested 3-second reference is fitted to 56 frames by H3.
    expect(maskVideoBoundaries(reference, 56 / 24, 97 / 24, 56 / 24)).toEqual([
      { side: 'start', time: 8 / 24 }, { side: 'end', time: 177 / 24 },
    ]);
  });
  it('omits cuts outside a shortened window, at its edge, and on disabled sides', () => {
    expect(maskVideoBoundaries(reference, 48 / 24, 4, 24 / 24)).toEqual([]);
    expect(maskVideoBoundaries(reference, 0, 4, 0)).toEqual([]);
    expect(maskVideoBoundaries(undefined, 3, 4, 3)).toEqual([]);
    expect(maskVideoBoundaries({ before: reference.beforeClips![1], after: reference.afterClips![0] }, 2, 4, 1)).toEqual([]);
  });
  it.each(['loop', 'extend'] as const)('omits end cuts for %s references', mode => {
    expect(maskVideoBoundaries({ ...reference, mode }, 3, 4, 3)).toEqual([{ side: 'start', time: 1 }]);
  });
  it('keeps every cut in playback order, including repeated assets and stills', () => {
    const a = clip('same-video', 24, 48), b = { ...clip('still', 0, 12), kind: 'image' as const };
    expect(maskVideoBoundaries({ beforeClips: [a, b, a] }, 2.5, 4, 0)).toEqual([
      { side: 'start', time: 1 }, { side: 'start', time: 1.5 },
    ]);
  });
});
