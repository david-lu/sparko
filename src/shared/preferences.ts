export const pinchZoomPreference = 'sparko:pinch-zoom-sensitivity';
export const defaultPinchZoomSensitivity = 3;
export const minPinchZoomSensitivity = .5;
export const maxPinchZoomSensitivity = 5;

// The old key auto-saved the previous off default even without a user choice.
// Start the enabled default once, then persist subsequent preference changes.
export const defaultTurboPreference = 'sparko:default-turbo:v2';
export const defaultTurboEnabled = true;
export function savedDefaultTurbo(): boolean {
  try {
    const saved = localStorage.getItem(defaultTurboPreference);
    return saved === 'true' ? true : saved === 'false' ? false : defaultTurboEnabled;
  }
  catch { return defaultTurboEnabled; }
}

export const convertImportedVideoPreference = 'sparko:convert-imported-video-24fps';
export const defaultConvertImportedVideo = false;
export function savedConvertImportedVideo(): boolean {
  try { return localStorage.getItem(convertImportedVideoPreference) === 'true'; }
  catch { return defaultConvertImportedVideo; }
}

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
