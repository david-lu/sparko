export const pinchZoomPreference = 'sparko:pinch-zoom-sensitivity';
export const defaultPinchZoomSensitivity = 3;
export const minPinchZoomSensitivity = .5;
export const maxPinchZoomSensitivity = 5;

export function savedPinchZoomSensitivity() {
  try {
    const saved = localStorage.getItem(pinchZoomPreference), value = saved === null ? NaN : Number(saved);
    if (Number.isFinite(value)) return Math.max(minPinchZoomSensitivity, Math.min(maxPinchZoomSensitivity, Math.round(value * 4) / 4));
  } catch { /* Use the default when storage is unavailable. */ }
  return defaultPinchZoomSensitivity;
}
