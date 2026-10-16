import { INTERSTITIAL } from '../../../shared/constants';
import type { Interstitial } from '../../../shared/interstitials';

export const interstitialKey = (sourceId: string) => `sparko:interstitials:v1:${sourceId}`;
export function loadInterstitials(sourceId: string): Interstitial[] {
  try {
    const stored = localStorage.getItem(interstitialKey(sourceId));
    const saved: unknown = JSON.parse(stored ?? localStorage.getItem(`sparko:pins:v1:${sourceId}`) ?? '[]');
    if (!Array.isArray(saved)) return [];
    const ids = new Set<string>();
    return saved.flatMap((item): Interstitial[] => {
      if (!item || typeof item.id !== 'string' || ids.has(item.id) || !Number.isFinite(item.time) || item.time < 0) return [];
      ids.add(item.id);
      const phase = ['draft', 'queued', 'rendering', 'loading', 'ready', 'error', 'cancelled'].includes(item.phase) ? item.phase : 'draft';
      const result = item.result && typeof item.result.url === 'string' && (item.result.url.startsWith('https://') || typeof item.result.assetId === 'string' && item.result.url === `asset:${item.result.assetId}`)
        && [item.result.start, item.result.duration, item.result.totalDuration].every(Number.isFinite)
        && item.result.start >= 0 && item.result.duration > 0 && item.result.start + item.result.duration <= item.result.totalDuration + 0.1 ? item.result : undefined;
      return [{ id: item.id, label: typeof item.label === 'string' ? item.label.replace(/^Pin (\d+)$/, 'Interstitial $1') : 'Interstitial', time: item.time,
        start_range: Number.isFinite(item.start_range) ? item.start_range : INTERSTITIAL.defaultRange,
        end_range: Number.isFinite(item.end_range) ? item.end_range : INTERSTITIAL.defaultRange,
        prompt: typeof item.prompt === 'string' ? item.prompt : '', phase: phase === 'ready' && !result ? 'error' : phase,
        requestId: typeof item.requestId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(item.requestId) ? item.requestId : undefined,
        result, error: typeof item.error === 'string' ? item.error : undefined }];
    }).sort((a, b) => a.time - b.time);
  } catch { return []; }
}
export function saveInterstitials(sourceId: string, items: Interstitial[]) {
  try { localStorage.setItem(interstitialKey(sourceId), JSON.stringify(items)); return true; }
  catch { return false; }
}
