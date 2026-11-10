import { z } from 'zod';
import { curveStrength, maskPointSchema, type MaskPoint } from './mask-curves.js';

export const MAX_FADE_POINTS = 16;

/**
 * Share of the incoming clip across a crossfade. Positions are fractions of the
 * fade, so a shape survives duration edits and shortened playback overlaps.
 */
export const fadeCurveSchema = z.object({
  interpolation: z.enum(['linear', 'bezier']),
  points: z.array(maskPointSchema).min(2).max(MAX_FADE_POINTS),
}).refine(({ points }) => points[0].position === 0 && points[0].strength === 0 && points.at(-1)!.position === 1 && points.at(-1)!.strength === 1
  && points.every((point, index) => !index || point.position > points[index - 1].position),
'A crossfade curve must rise from 0% at its start to 100% at its end.');
export type FadeCurve = z.infer<typeof fadeCurveSchema>;
export type FadePoint = MaskPoint;

export const linearFade = (): FadeCurve => ({ interpolation: 'linear', points: [{ position: 0, strength: 0 }, { position: 1, strength: 1 }] });
const eased = (outInfluence: number, outStrength: number, inInfluence: number, inStrength: number): FadeCurve => ({ interpolation: 'bezier', points: [
  { position: 0, strength: 0, out: { influence: outInfluence, strength: outStrength } },
  { position: 1, strength: 1, in: { influence: inInfluence, strength: inStrength } }] });

export const FADE_PRESETS: readonly { id: string; label: string; curve: FadeCurve }[] = [
  { id: 'linear', label: 'Linear', curve: linearFade() },
  { id: 'slow-start', label: 'Slow start', curve: eased(.32, 0, .33, 0) },
  { id: 'fast-start', label: 'Fast start', curve: eased(.33, 1, .32, 1) },
  { id: 's-curve', label: 'S-curve', curve: eased(.65, 0, .65, 1) },
];

const sameCurve = (a: FadeCurve, b: FadeCurve) => JSON.stringify(a) === JSON.stringify(b);
export const isLinearFade = (curve?: FadeCurve) => !curve || sameCurve(curve, linearFade());
export const fadePreset = (curve?: FadeCurve) => FADE_PRESETS.find(preset => sameCurve(preset.curve, curve ?? linearFade()))?.id;

/** Share of the incoming clip at a fraction of the fade. A missing curve is linear. */
export function fadeMix(curve: FadeCurve | undefined, progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  if (!curve) return t;
  return Math.max(0, Math.min(1, curveStrength(curve.points, t, curve.interpolation)));
}

/** The mix and its change per second over the next audio ramp, so scheduled gain follows the curve. */
export function fadeLevel(curve: FadeCurve | undefined, progress: number, progressPerSecond: number, horizon = .04) {
  const mix = fadeMix(curve, progress), step = Math.min(1 - progress, progressPerSecond * horizon);
  return { mix, rate: step > 1e-6 ? (fadeMix(curve, progress + step) - mix) / step * progressPerSecond : 0 };
}
