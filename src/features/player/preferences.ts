export const crossfadePreference = 'sparko:interstitial-crossfades';
export function savedCrossfadePreference() {
  try { return localStorage.getItem(crossfadePreference) !== 'false'; } catch { return true; }
}
export const framingPreference = 'sparko:match-generated-framing';
export function savedFramingPreference() {
  try { return localStorage.getItem(framingPreference) === 'true'; } catch { return false; }
}
