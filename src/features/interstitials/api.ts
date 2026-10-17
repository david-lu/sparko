import { INTERSTITIAL } from '../../../shared/constants';
import type { GenerationJob } from '../../../shared/contracts';
import { referenceRange, validateInterstitialDuration, type Interstitial, type GenerationMethod } from '../../../shared/interstitials';
import { comfyReferenceRange } from '../../../shared/comfy';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import { request, sendForm } from '../../shared/api';

export async function generateInterstitial(item: Interstitial, engine: MediaEngine, info: MediaInfo, signal: AbortSignal,
  onProgress: (phase: 'preparing' | 'uploading', fraction?: number) => void): Promise<GenerationJob> {
  if (item.method === 'comfy') {
    const readiness = await request<{ ready: boolean; message?: string }>('/api/comfy/status', { signal });
    if (!readiness.ready) throw new Error(readiness.message || 'Comfy Cloud is not ready.');
    const range = comfyReferenceRange(item, info.duration);
    if (!item.prompt.trim()) throw new Error('Describe the interstitial before generating.');
    onProgress('preparing', 0);
    const clip = await engine.exportMp4(range, { maxHeight: 768, frameRate: INTERSTITIAL.referenceFps, signal, onProgress: value => onProgress('preparing', value) });
    if (clip.size > INTERSTITIAL.maxReferenceBytes) throw new Error('The reference clip exceeds 50 MB. Shorten the reference ranges.');
    signal.throwIfAborted();
    const body = new FormData(); body.set('video', clip, 'comfy-reference.mp4');
    body.set('before', String(range.insertAt)); body.set('after', String(range.after));
    body.set('duration', String(item.duration)); body.set('prompt', item.prompt.trim());
    onProgress('uploading');
    return sendForm<GenerationJob>('/api/comfy/interstitials', body, signal);
  }
  const range = referenceRange(item, info.duration);
  validateInterstitialDuration(item.duration);
  if (!item.prompt.trim()) throw new Error('Describe the interstitial before generating.');
  onProgress('preparing', 0);
  const clip = await engine.exportMp4(range, { maxHeight: 768, frameRate: INTERSTITIAL.referenceFps, signal, onProgress: value => onProgress('preparing', value) });
  if (clip.size > INTERSTITIAL.maxReferenceBytes) throw new Error('The reference clip exceeds 50 MB. Shorten the reference ranges.');
  signal.throwIfAborted();
  const body = new FormData();
  body.set('video', clip, 'interstitial-reference.mp4');
  body.set('start', String(range.insertAt)); body.set('resume', String(range.resumeAt)); body.set('fps', String(range.fps)); body.set('prompt', item.prompt.trim());
  body.set('duration', String(item.duration));
  body.set('enable_prompt_expansion', String(item.enable_prompt_expansion));
  onProgress('uploading');
  return sendForm<GenerationJob>('/api/interstitials', body, signal);
}
export const getInterstitialJob = (id: string, signal?: AbortSignal, method: GenerationMethod = 'fal') => request<GenerationJob>(`/api/${method}/jobs/${encodeURIComponent(id)}`, { signal });
export const cancelInterstitialJob = (id: string, method: GenerationMethod = 'fal') => request<GenerationJob>(`/api/${method}/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
