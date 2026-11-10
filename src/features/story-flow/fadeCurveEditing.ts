import { MAX_FADE_POINTS, fadeMix, type FadeCurve, type FadePoint } from '../../../shared/fade-curves';

export type HandleSide = 'in' | 'out';
const MIN_GAP = .001;
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const NICE_SPANS = [.25, .5, .75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 45, 60];

/** Time shown by the graph: the fade plus room to drag its end further, within the allowed maximum. */
export function fadeAxisSpan(duration: number, max: number) {
  const wanted = Math.max(.25, duration * 1.4), nice = NICE_SPANS.find(span => span >= wanted) ?? Math.ceil(wanted / 30) * 30;
  return Math.max(duration, Math.min(nice, max)) || nice;
}

/** Bézier handles that reproduce the straight segments, so bending one leaves the others in place. */
export function withLinearHandles(curve: FadeCurve): FadeCurve {
  if (curve.interpolation === 'bezier') return curve;
  return { interpolation: 'bezier', points: curve.points.map((point, index, points) => ({ ...point,
    ...(index ? { in: { influence: 1 / 3, strength: point.strength + (points[index - 1].strength - point.strength) / 3 } } : {}),
    ...(index < points.length - 1 ? { out: { influence: 1 / 3, strength: point.strength + (points[index + 1].strength - point.strength) / 3 } } : {}) })) };
}

/** Where a handle sits, as a fade position and level. Missing handles use the curve's implied tangent. */
export function handlePoint(curve: FadeCurve, index: number, side: HandleSide) {
  const point = curve.points[index], neighbor = curve.points[index + (side === 'in' ? -1 : 1)];
  if (!neighbor) return;
  const handle = curve.interpolation === 'bezier' ? point[side] ?? { influence: 1 / 3, strength: point.strength } : withLinearHandles(curve).points[index][side]!;
  return { position: point.position + (neighbor.position - point.position) * handle.influence, strength: handle.strength };
}

const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Add a point on the curve. Bézier segments are split exactly, so the shape does not move. */
export function insertFadePoint(curve: FadeCurve, position: number, strength?: number): { curve: FadeCurve; index: number } | undefined {
  const points = curve.points, right = points.findIndex(point => point.position > position);
  if (right <= 0 || points.length >= MAX_FADE_POINTS) return;
  const a = points[right - 1], b = points[right];
  if (position - a.position < MIN_GAP || b.position - position < MIN_GAP) return;
  if (curve.interpolation === 'linear' || strength !== undefined) {
    const point: FadePoint = { position, strength: clamp(strength ?? fadeMix(curve, position)) };
    return { curve: { ...curve, points: [...points.slice(0, right), point, ...points.slice(right)] }, index: right };
  }
  const width = b.position - a.position;
  const p0 = { x: a.position, y: a.strength }, p3 = { x: b.position, y: b.strength };
  const p1 = { x: a.position + width * (a.out?.influence ?? 1 / 3), y: a.out?.strength ?? a.strength };
  const p2 = { x: b.position - width * (b.in?.influence ?? 1 / 3), y: b.in?.strength ?? b.strength };
  const x = (t: number) => (1 - t) ** 3 * p0.x + 3 * (1 - t) ** 2 * t * p1.x + 3 * (1 - t) * t * t * p2.x + t ** 3 * p3.x;
  let low = 0, high = 1;
  for (let i = 0; i < 32; i++) { const mid = (low + high) / 2; if (x(mid) < position) low = mid; else high = mid; }
  const t = (low + high) / 2, q0 = lerp(p0, p1, t), q1 = lerp(p1, p2, t), q2 = lerp(p2, p3, t);
  const r0 = lerp(q0, q1, t), r1 = lerp(q1, q2, t), s = lerp(r0, r1, t);
  const left = s.x - a.position, after = b.position - s.x;
  const point: FadePoint = { position, strength: clamp(s.y),
    in: { influence: clamp((s.x - r0.x) / left), strength: clamp(r0.y) }, out: { influence: clamp((r1.x - s.x) / after), strength: clamp(r1.y) } };
  const next = points.map((value, index) => index === right - 1 ? { ...value, out: { influence: clamp((q0.x - a.position) / left), strength: clamp(q0.y) } }
    : index === right ? { ...value, in: { influence: clamp((b.position - q2.x) / after), strength: clamp(q2.y) } } : value);
  return { curve: { ...curve, points: [...next.slice(0, right), point, ...next.slice(right)] }, index: right };
}

/** Move an interior point between its neighbours. Its handles keep their shape. */
export function moveFadePoint(curve: FadeCurve, index: number, position: number, strength: number): FadeCurve {
  const points = curve.points, point = points[index], before = points[index - 1], after = points[index + 1];
  if (!before || !after || after.position - before.position <= 2 * MIN_GAP) return curve;
  const level = clamp(strength), delta = level - point.strength;
  const shift = (handle: FadePoint['in']) => handle && { ...handle, strength: clamp(handle.strength + delta) };
  const moved: FadePoint = { ...point, position: clamp(position, before.position + MIN_GAP, after.position - MIN_GAP), strength: level,
    ...(point.in ? { in: shift(point.in) } : {}), ...(point.out ? { out: shift(point.out) } : {}) };
  return { ...curve, points: points.map((value, i) => i === index ? moved : value) };
}

export function moveFadeHandle(curve: FadeCurve, index: number, side: HandleSide, position: number, strength: number): FadeCurve {
  const shaped = withLinearHandles(curve), point = shaped.points[index], neighbor = shaped.points[index + (side === 'in' ? -1 : 1)];
  if (!point || !neighbor) return curve;
  const handle = { influence: clamp((position - point.position) / (neighbor.position - point.position)), strength: clamp(strength) };
  return { ...shaped, points: shaped.points.map((value, i) => i === index ? { ...value, [side]: handle } : value) };
}

export const removeFadePoint = (curve: FadeCurve, index: number): FadeCurve =>
  index > 0 && index < curve.points.length - 1 ? { ...curve, points: curve.points.filter((_, i) => i !== index) } : curve;

/** The middle of the widest gap, for adding a point without a pointer. */
export function nextPointPosition(curve: FadeCurve) {
  let best = 0;
  for (let i = 1; i < curve.points.length; i++) if (curve.points[i].position - curve.points[i - 1].position > curve.points[best + 1].position - curve.points[best].position) best = i - 1;
  return (curve.points[best].position + curve.points[best + 1].position) / 2;
}
