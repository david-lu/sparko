import { describe, expect, it } from 'vitest';
import { promptReferenceTimingSchema, promptTimeline, promptTimelineDirection } from '../../shared/prompt-timing';

describe('prompt time within the full H3 render', () => {
  it.each([
    { prefixFrames: 0, suffixFrames: 0, middle: 158, total: 158 },
    { prefixFrames: 39, suffixFrames: 0, middle: 153, total: 192 },
    { prefixFrames: 0, suffixFrames: 39, middle: 153, total: 192 },
    { prefixFrames: 39, suffixFrames: 39, middle: 148, total: 226 },
    { prefixFrames: 90, suffixFrames: 56, middle: 148, total: 294 },
  ])('uses encoded references and padded body frames: $prefixFrames + $middle + $suffixFrames', ({ prefixFrames, suffixFrames, middle, total }) => {
    const timing = promptTimeline(6, { prefixFrames, suffixFrames });
    expect(timing.generatedStart).toBe(prefixFrames / 24);
    expect(timing.generatedDuration).toBe(middle / 24);
    expect(timing.generatedEnd).toBeCloseTo((prefixFrames + middle) / 24, 8);
    expect(timing.totalDuration).toBe(total / 24);
  });
  it('distinguishes footage from pictures and scopes only the generated performance', () => {
    const footage = promptTimelineDirection(promptTimeline(6, { prefixFrames: 39, suffixFrames: 39 }));
    expect(footage).toContain('from 1.625 to 7.792 seconds');
    expect(footage).toContain('occupy 0 to 1.625 seconds');
    expect(footage).toContain('occupy 7.792 to 9.417 seconds');
    expect(footage).toContain('unmasked reference content');
    const pictures = promptTimelineDirection(promptTimeline(6, { prefixFrames: 0, suffixFrames: 0 }));
    expect(pictures).toContain('from 0 to 6.583 seconds');
    expect(pictures).not.toContain('reference footage');
  });
  it('rejects unencoded windows and a render that exceeds the total H3 limit', () => {
    for (const frames of [-1, 1, 38, 48, 96, Infinity]) expect(promptReferenceTimingSchema.safeParse({ prefixFrames: frames, suffixFrames: 0 }).success).toBe(false);
    expect(() => promptTimeline(13, { prefixFrames: 39, suffixFrames: 39 })).toThrow('362 frames including context');
  });
});
