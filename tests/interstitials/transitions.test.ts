import { describe, expect, it } from 'vitest';
import { compositionTransitions, segmentTime, transitionWeight } from '../../src/media/CompositionTransitions';
import type { TimelineSegment } from '../../src/media/TimelineComposition';

const segment = (kind: TimelineSegment['kind'], startFrame: number, endFrame: number, sourceStart = 0): TimelineSegment =>
  ({ id: `${kind}:${startFrame}`, kind, label: kind, startFrame, endFrame, sourceStart, source: { id: kind, name: kind, url: `/${kind}.mp4` } });

describe('interstitial crossfades', () => {
  it('centers four-frame dissolves at both joins without shifting timeline positions', () => {
    const segments = [segment('source', 0, 24), segment('interstitial', 24, 168, 2), segment('source', 168, 216, 1)];
    const before = structuredClone(segments), fades = compositionTransitions(segments);
    expect(fades.map(fade => [fade.startFrame, fade.endFrame])).toEqual([[22, 26], [166, 170]]);
    expect(segments).toEqual(before);
    expect([22, 23, 24, 25].map(frame => transitionWeight(fades[0], frame + .5))).toEqual([.125, .375, .625, .875]);
    expect(segmentTime(fades[0].after, 22, 24)).toBeCloseTo(2 - 2 / 24);
    expect(segmentTime(fades[1].before, 169, 24)).toBeCloseTo(8 + 1 / 24);
  });
  it('shortens fades for adjacent short clips and never overlaps or fades across gaps', () => {
    const fades = compositionTransitions([segment('source', 0, 24), segment('interstitial', 24, 26), segment('interstitial', 26, 30), segment('source', 30, 54)]);
    expect(fades.map(fade => [fade.startFrame, fade.endFrame])).toEqual([[23, 25], [25, 27], [28, 32]]);
    expect(compositionTransitions([segment('source', 0, 24), segment('interstitial', 25, 49)])).toEqual([]);
    expect(compositionTransitions([segment('source', 0, 24), segment('interstitial', 24, 25), segment('source', 25, 49)])).toEqual([]);
  });
  it('keeps source-only cuts and generation-reference holds intact', () => {
    const held = { ...segment('source', 24, 48, 3), still: true };
    expect(compositionTransitions([segment('source', 0, 24), held])).toEqual([]);
    expect(segmentTime(held, 42, 24)).toBe(3);
  });
});
