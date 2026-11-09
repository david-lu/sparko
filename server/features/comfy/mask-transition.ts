import { COMFY, TIMELINE_FPS } from '../../../shared/constants.js';
import { maskStrength, type MaskCurve } from '../../../shared/mask-curves.js';

export function videoCurvePoints(curve: MaskCurve, prefix: number, suffix: number, frames: number): string {
  return Array.from({ length: frames }, (_, frame) => `${frame}:(${frame >= prefix && frame < frames - suffix ? 1 : Number(maskStrength(curve, (frame + .5) / TIMELINE_FPS,
    prefix / TIMELINE_FPS, (frames - prefix - suffix) / TIMELINE_FPS, suffix / TIMELINE_FPS).toFixed(6))})`).join(',');
}

/** Sample the audio clock without stretching a mask over VAE padding. Any
 * latent interval touching the empty middle must be fully regenerated.
 */
export function audioCurveSpans(curve: MaskCurve, prefix: number, suffix: number, frames: number) {
  const rate = COMFY.audioLatentsPerSecond, before = prefix / TIMELINE_FPS, after = suffix / TIMELINE_FPS;
  const duration = (frames - prefix - suffix) / TIMELINE_FPS, first = Math.floor(before * rate), end = Math.ceil((before + duration) * rate);
  const length = Math.max(end, Math.floor(frames / TIMELINE_FPS * rate) - 1);
  const spans: { start: number; length?: number; strength: number }[] = [];
  for (let index = 0; index < length; index++) {
    const strength = index >= first && index < end ? 1
      : Number(maskStrength(curve, (index + .5) / rate, before, duration, after).toFixed(6));
    const last = spans.at(-1);
    if (last?.strength === strength) last.length!++;
    else spans.push({ start: index, length: 1, strength });
  }
  // Extend the endpoint through the last audio column and any VAE padding.
  // Starting inside the timeline avoids an out-of-bounds composite if the
  // fitted audio length rounds down rather than up.
  if (suffix) spans.push({ start: length, strength: curve.end.at(-1)!.strength });
  else spans.at(-1)!.length = undefined;
  return spans.filter(span => span.strength > 0);
}

/** Full strength throughout the generated frames; soft values only in references.
 * The downstream VAE-aware max reduction keeps any group touching the gap white.
 */
export function videoTransitionPoints(prefix: number, suffix: number, frames: number, milliseconds: number): string {
  const fade = Math.max(1, Math.round(milliseconds / 1000 * TIMELINE_FPS));
  const points = new Map<number, number>([[0, prefix ? 0 : 1], [frames - 1, suffix ? 0 : 1]]);
  if (prefix) {
    points.set(Math.max(0, prefix - fade), 0);
    points.set(prefix, 1);
  }
  if (suffix) {
    const end = frames - suffix;
    points.set(end, 1);
    points.set(Math.min(frames - 1, end + fade), 0);
  }
  return [...points].sort(([a], [b]) => a - b).map(([frame, value]) => `${frame}:(${value})`).join(',');
}
