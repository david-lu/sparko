import { describe, expect, it } from 'vitest';
import { compositionTransitions, segmentTime, transitionWeight } from '../../src/media/CompositionTransitions';
import type { TimelineSegment } from '../../src/media/TimelineComposition';

const segment = (kind: TimelineSegment['kind'], startFrame: number, endFrame: number, sourceStart = 0): TimelineSegment =>
  ({ id: `${kind}:${startFrame}`, kind, label: kind, startFrame, endFrame, sourceStart, source: { id: kind, name: kind, url: `/${kind}.mp4` },
    ...(kind === 'interstitial' ? { generated: { url: '/generated.mp4', start: sourceStart, duration: (endFrame - startFrame) / 24, totalDuration: sourceStart + (endFrame - startFrame) / 24 + 1 } } : {}) });

describe('interstitial crossfades', () => {
  it('fades exclusively in the reference handles before and after the generated body', () => {
    const segments = [segment('source', 0, 24), segment('interstitial', 24, 168, 2), segment('source', 168, 216, 1)];
    const before = structuredClone(segments), fades = compositionTransitions(segments);
    expect(fades.map(fade => [fade.startFrame, fade.endFrame])).toEqual([[20, 24], [168, 172]]);
    expect(segments).toEqual(before);
    expect([20, 21, 22, 23].map(frame => transitionWeight(fades[0], frame + .5))).toEqual([.125, .375, .625, .875]);
    expect(segmentTime(fades[0].after, 22, 24)).toBeCloseTo(2 - 2 / 24);
    expect(segmentTime(fades[1].before, 169, 24)).toBeCloseTo(8 + 1 / 24);
  });
  it('never fades across adjacent generated bodies, missing references, or gaps', () => {
    const fades = compositionTransitions([segment('source', 0, 24), segment('interstitial', 24, 26, 1), segment('interstitial', 26, 30, 1), segment('source', 30, 54)]);
    expect(fades.map(fade => [fade.startFrame, fade.endFrame])).toEqual([[20, 24], [30, 34]]);
    expect(compositionTransitions([segment('source', 0, 24), segment('interstitial', 25, 49)])).toEqual([]);
    const body = { ...segment('interstitial', 24, 48), generated: { url: '', start: 0, duration: 1, totalDuration: 1 } };
    expect(compositionTransitions([segment('source', 0, 24), body, segment('source', 48, 72)])).toEqual([]);
    expect(compositionTransitions([segment('source', 0, 24), { ...body, generated: undefined }, segment('source', 48, 72)])).toEqual([]);
  });
  it('keeps source-only cuts and generation-reference holds intact', () => {
    const held = { ...segment('source', 24, 48, 3), still: true };
    expect(compositionTransitions([segment('source', 0, 24), held])).toEqual([]);
    expect(segmentTime(held, 42, 24)).toBe(3);
  });
  it('clamps the selected length to saved reference ranges, even for a very short generated body', () => {
    const segments = [segment('source', 0, 48), segment('interstitial', 48, 50, .5), segment('source', 50, 98)];
    expect(compositionTransitions(segments, 8).map(fade => [fade.startFrame, fade.endFrame])).toEqual([[40, 48], [50, 58]]);
    const fades = compositionTransitions(segments, 48);
    expect(fades.map(fade => [fade.startFrame, fade.endFrame])).toEqual([[36, 48], [50, 74]]);
    for (const fade of fades) for (let frame = fade.startFrame; frame < fade.endFrame; frame++) {
      const time = segmentTime(segments[1], frame, 24), range = segments[1].generated!;
      expect(time < range.start || time >= range.start + range.duration).toBe(true);
    }
  });
  it('shares short source overlaps without mixing three clips or touching either generated body', () => {
    const fades = compositionTransitions([segment('interstitial', 0, 24, 1), segment('source', 24, 30), segment('interstitial', 30, 54, 1)], 24);
    expect(fades.map(fade => [fade.startFrame, fade.endFrame])).toEqual([[24, 27], [27, 30]]);
  });
  it('samples the exact saved end of a body with fractional frame bounds', () => {
    const body = segment('interstitial', 24, 48, 1);
    body.generated!.duration = 1.01;
    expect(segmentTime(body, 48, 24)).toBe(2.01);
  });
});
