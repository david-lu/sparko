export type Pin = { id: string; time: number; label: string };
const key = (id: string) => `sparko:pins:v1:${id}`;
export function loadPins(id: string): Pin[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key(id)) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter((pin): pin is Pin => typeof pin?.id === 'string' && typeof pin?.label === 'string' && typeof pin?.time === 'number' && Number.isFinite(pin.time) && pin.time >= 0);
  } catch { return []; }
}
export function savePins(id: string, pins: Pin[]): boolean {
  try { localStorage.setItem(key(id), JSON.stringify(pins)); return true; } catch { return false; }
}
