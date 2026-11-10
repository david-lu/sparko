import { z } from 'zod';

const handle = z.object({ influence: z.number().finite().min(0).max(1), strength: z.number().finite().min(0).max(1) });
const point = z.object({ position: z.number().finite().min(0).max(1), strength: z.number().finite().min(0).max(1), in: handle.optional(), out: handle.optional() });
export const maskPointSchema = point;
export type MaskPoint = z.infer<typeof point>;
const points = z.array(point)
  .min(2).max(16).refine(points => points.length >= 2 && points[0].position === 0 && points.at(-1)!.position === 1
    && points.every((point, i) => !i || point.position > points[i - 1].position), 'Mask pins must be ordered from 0 to 1.');
/** Positions are relative to each reference, so edits survive reference length changes. */
export const maskCurveSchema = z.object({ interpolation: z.enum(['linear', 'smooth', 'bezier']), start: points, end: points, body: points.optional() })
  .refine(curve => curve.start.at(-1)?.strength === 1 && curve.end[0]?.strength === 1, 'The generated section must stay fully masked.');
export type MaskCurve = z.infer<typeof maskCurveSchema>;
export type MaskSide = 'start' | 'end';

export function defaultMaskCurve(before: number, after: number, milliseconds: number): MaskCurve {
  const start = Math.min(1 - .00001, Math.max(0, 1 - milliseconds / 1000 / (before || 1)));
  const end = Math.max(.00001, Math.min(1, milliseconds / 1000 / (after || 1)));
  return { interpolation: 'linear',
    start: [{ position: 0, strength: 0 }, ...(start > 0 ? [{ position: start, strength: 0 }] : []), { position: 1, strength: 1 }],
    end: [{ position: 0, strength: 1 }, ...(end < 1 ? [{ position: end, strength: 0 }] : []), { position: 1, strength: 0 }] };
}

export function curveStrength(points: MaskPoint[], position: number, interpolation: MaskCurve['interpolation']): number {
  if (position <= 0) return points[0].strength;
  if (position >= 1) return points.at(-1)!.strength;
  const right = points.findIndex(point => point.position >= position), a = points[right - 1], b = points[right];
  const t = (position - a.position) / (b.position - a.position);
  if (interpolation === 'bezier') {
    const cubic = (t: number, a: number, b: number, c: number, d: number) => (1-t)**3*a + 3*(1-t)**2*t*b + 3*(1-t)*t*t*c + t**3*d;
    let low = 0, high = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2;
      if (cubic(mid, 0, a.out?.influence ?? 1/3, 1-(b.in?.influence ?? 1/3), 1) < t) low = mid;
      else high = mid;
    }
    return cubic((low+high)/2, a.strength, a.out?.strength ?? a.strength, b.in?.strength ?? b.strength, b.strength);
  }
  const weight = interpolation === 'smooth' ? t * t * (3 - 2 * t) : t;
  return a.strength + (b.strength - a.strength) * weight;
}

export function maskStrength(curve: MaskCurve, time: number, before: number, duration: number, after: number): number {
  if (before > 0 && time < before) return curveStrength(curve.start, time / before, curve.interpolation);
  if (after > 0 && time >= before + duration) return curveStrength(curve.end, (time - before - duration) / after, curve.interpolation);
  if (curve.body && duration > 0) return curveStrength(curve.body, (time - before) / duration, curve.interpolation);
  return 1;
}
