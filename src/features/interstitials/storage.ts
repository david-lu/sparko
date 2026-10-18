import { INTERSTITIAL } from '../../../shared/constants';
import { generationMethods, interstitialSettings, normalizeGenerationMethod, type ClipReference, type GenerationReference, type Interstitial, type InterstitialResult, type InterstitialSettings } from '../../../shared/interstitials';

function readReference(value: unknown): GenerationReference | undefined {
  const validClip = (clip: ClipReference) => clip && typeof clip.sceneId === 'string' && typeof clip.assetId === 'string'
    && Number.isInteger(clip.inFrame) && Number.isInteger(clip.outFrame) && clip.inFrame >= 0 && clip.outFrame > clip.inFrame;
  const input = value as GenerationReference | undefined;
  return input && validClip(input.before) && (!input.after || validClip(input.after)) ? input : undefined;
}

function readSettings(value: unknown): InterstitialSettings | undefined {
  if (!value || typeof value !== 'object') return;
  const settings = value as InterstitialSettings;
  const method = (value as { method?: string }).method;
  if (method !== undefined && method !== 'fal' && !generationMethods.includes(method as InterstitialSettings['method'] & string)) return;
  if (![settings.start_range, settings.end_range, settings.duration].every(value => typeof value === 'number' && Number.isFinite(value)) ||
    typeof settings.prompt !== 'string' || typeof settings.enable_prompt_expansion !== 'boolean') return;
  return interstitialSettings({ ...settings, method: normalizeGenerationMethod(method) });
}

function readResult(value: unknown): InterstitialResult | undefined {
  if (!value || typeof value !== 'object') return;
  const result = value as Partial<InterstitialResult>;
  if (typeof result.url !== 'string' || !(result.url.startsWith('https://') || /^\/api\/comfy\/assets\/[A-Za-z0-9_-]{8,128}\/content$/.test(result.url) || typeof result.assetId === 'string' && result.url === `asset:${result.assetId}`)) return;
  if (![result.start, result.duration, result.totalDuration].every(value => typeof value === 'number' && Number.isFinite(value))) return;
  if (result.start! >= 0 && result.duration! > 0 && result.start! + result.duration! <= result.totalDuration! + 0.1) return { ...result, reference: readReference(result.reference) } as InterstitialResult;
}

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
      const result = readResult(item.result);
      return [{ id: item.id, label: typeof item.label === 'string' ? item.label.replace(/^Pin (\d+)$/, 'Interstitial $1') : 'Interstitial', time: item.time, kind: item.kind === 'call-response' ? 'call-response' : item.kind === 'regular' ? 'regular' : undefined, groupId: typeof item.groupId === 'string' ? item.groupId : undefined,
        continuity: typeof item.continuity === 'string' ? item.continuity : undefined, dialogue: typeof item.dialogue === 'string' ? item.dialogue : undefined, loopAudio: typeof item.loopAudio === 'boolean' ? item.loopAudio : undefined,
        start_range: Number.isFinite(item.start_range) ? item.start_range : INTERSTITIAL.defaultRange,
        end_range: Number.isFinite(item.end_range) ? item.end_range : INTERSTITIAL.defaultRange,
        duration: Number.isFinite(item.duration) ? item.duration : INTERSTITIAL.defaultDuration,
        enable_prompt_expansion: typeof item.enable_prompt_expansion === 'boolean' ? item.enable_prompt_expansion : INTERSTITIAL.enablePromptExpansion,
        method: normalizeGenerationMethod(item.method), generationSettings: readSettings(item.generationSettings),
        requestMethod: item.requestMethod === 'fal' || generationMethods.includes(item.requestMethod) ? item.requestMethod
          : item.requestId && (item.method === 'fal' || item.generationSettings?.method === 'fal') ? 'fal' : undefined,
        requestReference: readReference(item.requestReference),
        requestInsertion: item.requestInsertion && [item.requestInsertion.start, item.requestInsertion.duration, item.requestInsertion.totalDuration].every((v: unknown) => typeof v === 'number' && Number.isFinite(v))
          && item.requestInsertion.start >= 0 && item.requestInsertion.duration > 0 && item.requestInsertion.start + item.requestInsertion.duration <= item.requestInsertion.totalDuration + 0.1 ? item.requestInsertion : undefined,
        prompt: typeof item.prompt === 'string' ? item.prompt : '', phase: phase === 'ready' && !result ? 'error' : phase,
        requestId: typeof item.requestId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(item.requestId) ? item.requestId : undefined,
        result, previousResult: readResult(item.previousResult), error: typeof item.error === 'string' ? item.error : undefined }];
    }).sort((a, b) => a.time - b.time);
  } catch { return []; }
}
export function saveInterstitials(sourceId: string, items: Interstitial[]) {
  try { localStorage.setItem(interstitialKey(sourceId), JSON.stringify(items)); return true; }
  catch { return false; }
}
