import { INTERSTITIAL_CROSSFADE_FRAMES, TIMELINE_FPS } from '../../../shared/constants';

export const crossfadePreference = 'sparko:interstitial-crossfades';
export function savedCrossfadePreference() {
  try { return localStorage.getItem(crossfadePreference) !== 'false'; } catch { return true; }
}
export const crossfadeLengthPreference = 'sparko:interstitial-crossfade-frames';
export const maxCrossfadeFrames = 2 * TIMELINE_FPS;
export function savedCrossfadeFrames() {
  try {
    const value = Number(localStorage.getItem(crossfadeLengthPreference));
    // Four frames was written automatically for every visitor by the old default.
    // Keep other browser choices when migrating a project to its own setting.
    if (Number.isFinite(value) && value >= 2 && value !== 4) return Math.min(maxCrossfadeFrames, Math.round(value / 2) * 2);
  } catch { /* Use the default when storage is unavailable. */ }
  return INTERSTITIAL_CROSSFADE_FRAMES;
}
export const framingPreference = 'sparko:match-generated-framing';
export function savedFramingPreference() {
  try { return localStorage.getItem(framingPreference) === 'true'; } catch { return false; }
}
