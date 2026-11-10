import { describe, expect, it } from 'vitest';
import { FADE_PRESETS, fadeCurveSchema, fadeLevel, fadeMix, fadePreset, isLinearFade, linearFade, type FadeCurve } from '../../shared/fade-curves';
import { fadeAxisSpan, handlePoint, insertFadePoint, moveFadeHandle, moveFadePoint, nextPointPosition, removeFadePoint } from '../../src/features/story-flow/fadeCurveEditing';
import { fadeRegionShape } from '../../src/features/story-flow/transitionRegions';
import { storyEdgeSchema } from '../../src/features/story-flow/schema';

const samples = (curve: FadeCurve) => Array.from({ length: 41 }, (_, i) => fadeMix(curve, i / 40));
const sCurve = FADE_PRESETS.find(preset => preset.id === 's-curve')!.curve;

describe('crossfade curves', () => {
  it('treats a missing curve as the linear fade playback always used', () => {
    for (const progress of [-1, 0, .3, .5, 1, 2]) expect(fadeMix(undefined, progress)).toBeCloseTo(Math.max(0, Math.min(1, progress)));
    expect(fadeLevel(undefined, .5, 2)).toEqual({ mix: .5, rate: expect.closeTo(2) });
    expect(fadeLevel(linearFade(), .99, 2).rate).toBeCloseTo(2);
    expect(isLinearFade(undefined)).toBe(true); expect(isLinearFade(linearFade())).toBe(true); expect(isLinearFade(sCurve)).toBe(false);
  });

  it('offers valid presets that start at 0%, end at 100% and never fall', () => {
    for (const preset of FADE_PRESETS) {
      expect(fadeCurveSchema.safeParse(preset.curve).success, preset.id).toBe(true);
      const values = samples(preset.curve);
      expect(values[0]).toBe(0); expect(values.at(-1)).toBe(1);
      values.slice(1).forEach((value, i) => expect(value, preset.id).toBeGreaterThanOrEqual(values[i] - 1e-9));
      expect(fadePreset(preset.curve)).toBe(preset.id);
    }
    expect(fadePreset(undefined)).toBe('linear');
  });

  it('rejects curves that would jump at either end of the fade', () => {
    expect(fadeCurveSchema.safeParse({ interpolation: 'linear', points: [{ position: 0, strength: .2 }, { position: 1, strength: 1 }] }).success).toBe(false);
    expect(fadeCurveSchema.safeParse({ interpolation: 'linear', points: [{ position: 0, strength: 0 }, { position: .5, strength: 1 }] }).success).toBe(false);
    expect(fadeCurveSchema.safeParse({ interpolation: 'linear', points: [{ position: 0, strength: 0 }, { position: .6, strength: .5 }, { position: .4, strength: .5 }, { position: 1, strength: 1 }] }).success).toBe(false);
    expect(storyEdgeSchema.safeParse({ id: 'e', from: 'a', to: 'b', event: 'next', label: 'Next', values: [], videoCrossfadeCurve: sCurve }).success).toBe(true);
  });

  it('adds points without changing the shape of linear or curved fades', () => {
    for (const curve of [linearFade(), sCurve, FADE_PRESETS[1].curve]) {
      const added = insertFadePoint(curve, .3)!;
      expect(added.index).toBe(1); expect(added.curve.points).toHaveLength(3);
      expect(fadeCurveSchema.safeParse(added.curve).success).toBe(true);
      samples(added.curve).forEach((value, i) => expect(value).toBeCloseTo(samples(curve)[i], 3));
      const again = insertFadePoint(added.curve, .7)!;
      samples(again.curve).forEach((value, i) => expect(value).toBeCloseTo(samples(curve)[i], 3));
    }
    expect(insertFadePoint(linearFade(), 0)).toBeUndefined();
    expect(insertFadePoint(linearFade(), .5, .9)!.curve.points[1]).toEqual({ position: .5, strength: .9 });
  });

  it('bends a linear curve from one handle without disturbing its other segments', () => {
    const curve = insertFadePoint(linearFade(), .5, .5)!.curve;
    expect(handlePoint(curve, 1, 'out')).toEqual({ position: expect.closeTo(.5 + .5 / 3), strength: expect.closeTo(.5 + .5 / 3) });
    const bent = moveFadeHandle(curve, 1, 'out', .6, 1);
    expect(bent.interpolation).toBe('bezier');
    for (const progress of [.1, .25, .4]) expect(fadeMix(bent, progress)).toBeCloseTo(progress, 3);
    expect(fadeMix(bent, .75)).toBeGreaterThan(.8);
    expect(handlePoint(bent, 1, 'out')).toEqual({ position: expect.closeTo(.6), strength: 1 });
    expect(handlePoint(bent, 0, 'in')).toBeUndefined();
  });

  it('keeps moved points between their neighbours and their handles with them', () => {
    const curve = insertFadePoint(sCurve, .5)!.curve;
    const moved = moveFadePoint(curve, 1, 2, -1);
    expect(moved.points[1].position).toBeLessThan(1); expect(moved.points[1].strength).toBe(0);
    expect(moved.points[1].in!.strength).toBeCloseTo(Math.max(0, curve.points[1].in!.strength - curve.points[1].strength));
    expect(fadeCurveSchema.safeParse(moved).success).toBe(true);
    expect(moveFadePoint(curve, 0, .5, .5)).toBe(curve);
    expect(removeFadePoint(curve, 1).points).toHaveLength(2);
    expect(removeFadePoint(curve, 2)).toBe(curve);
  });

  it('adds keyboard points in the widest gap and leaves room to lengthen the fade', () => {
    expect(nextPointPosition(linearFade())).toBe(.5);
    expect(nextPointPosition(insertFadePoint(linearFade(), .2)!.curve)).toBeCloseTo(.6);
    expect(fadeAxisSpan(.5, 10)).toBe(.75); expect(fadeAxisSpan(0, 10)).toBe(.25);
    expect(fadeAxisSpan(1, 1.2)).toBe(1.2); expect(fadeAxisSpan(2, 2)).toBe(2);
  });

  it('draws the clip overlays from the curve, including cropped regions', () => {
    expect(fadeRegionShape({ direction: 'in', progressStart: 0, progressEnd: 1 }, 2)).toBe('polygon(0.00% 100.00%,50.00% 50.00%,100.00% 0.00%,100% 100%,0 100%)');
    expect(fadeRegionShape({ direction: 'out', progressStart: .5, progressEnd: 1 }, 1)).toBe('polygon(0.00% 50.00%,100.00% 100.00%,100% 100%,0 100%)');
    expect(fadeRegionShape({ direction: 'in', progressStart: 0, progressEnd: 1, curve: sCurve }, 4)).toContain(`25.00% ${((1 - fadeMix(sCurve, .25)) * 100).toFixed(2)}%`);
  });
});
