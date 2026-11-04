export const pinchZoomPreference = 'sparko:pinch-zoom-sensitivity';
export const defaultPinchZoomSensitivity = 3;
export const minPinchZoomSensitivity = .5;
export const maxPinchZoomSensitivity = 5;

export type PlayheadTimeMode = 'internal' | 'elapsed';
export const playheadTimePreference = 'sparko:playhead-time';
export const defaultPlayheadTimeMode: PlayheadTimeMode = 'internal';
export function savedPlayheadTimeMode(): PlayheadTimeMode {
  try { return localStorage.getItem(playheadTimePreference) === 'elapsed' ? 'elapsed' : defaultPlayheadTimeMode; }
  catch { return defaultPlayheadTimeMode; }
}

export function savedPinchZoomSensitivity() {
  try {
    const saved = localStorage.getItem(pinchZoomPreference), value = saved === null ? NaN : Number(saved);
    if (Number.isFinite(value)) return Math.max(minPinchZoomSensitivity, Math.min(maxPinchZoomSensitivity, Math.round(value * 4) / 4));
  } catch { /* Use the default when storage is unavailable. */ }
  return defaultPinchZoomSensitivity;
}
