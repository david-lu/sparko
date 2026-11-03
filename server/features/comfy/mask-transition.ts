import { TIMELINE_FPS } from '../../../shared/constants.js';

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
