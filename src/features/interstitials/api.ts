import { INTERSTITIAL } from '../../../shared/constants';
import type { GenerationJob } from '../../../shared/contracts';
import { generationPrompt, type Interstitial } from '../../../shared/interstitials';
import { comfyDimensions, comfyReferenceRange } from '../../../shared/comfy';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import { request, sendForm } from '../../shared/api';

export async function generateInterstitial(item: Interstitial, engine: Pick<MediaEngine, 'exportMp4'>, info: MediaInfo, signal: AbortSignal,
  onProgress: (phase: 'preparing' | 'uploading', fraction?: number) => void): Promise<GenerationJob> {
  const readiness = await request<{ ready: boolean; message?: string }>('/api/comfy/status', { signal });
  if (!readiness.ready) throw new Error(readiness.message || 'Comfy Cloud is not ready.');
  const range = comfyReferenceRange(item, info.duration);
  if (!generationPrompt(item)) throw new Error('Describe the interstitial before generating.');
  onProgress('preparing', 0);
  const dimensions = comfyDimensions(info.width, info.height);
  const clip = await engine.exportMp4(range, { maxDimension: Math.max(dimensions.width, dimensions.height), frameRate: INTERSTITIAL.referenceFps,
    quality: 'high', signal, onProgress: value => onProgress('preparing', value) });
  if (clip.size > INTERSTITIAL.maxReferenceBytes) throw new Error('The reference clip exceeds 50 MB. Shorten the reference ranges.');
  signal.throwIfAborted();
  const body = new FormData(); body.set('video', clip, 'comfy-reference.mp4');
  body.set('before', String(range.insertAt)); body.set('after', String(range.after));
  body.set('duration', String(item.duration)); body.set('prompt', generationPrompt(item));
  body.set('mode', range.mode);
  onProgress('uploading');
  return sendForm<GenerationJob>('/api/comfy/interstitials', body, signal);
}
export const getInterstitialJob = (id: string, signal?: AbortSignal) => request<GenerationJob>(`/api/comfy/jobs/${encodeURIComponent(id)}`, { signal });
export const cancelInterstitialJob = (id: string) => request<GenerationJob>(`/api/comfy/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
