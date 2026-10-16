import { INTERSTITIAL } from '../../../shared/constants';
import type { FalJob } from '../../../shared/contracts';
import { referenceRange, type Interstitial } from '../../../shared/interstitials';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import { request, sendForm } from '../../shared/api';

export async function generateInterstitial(item: Interstitial, engine: MediaEngine, info: MediaInfo, signal: AbortSignal,
  onProgress: (phase: 'preparing' | 'uploading', fraction?: number) => void): Promise<FalJob> {
  const range = referenceRange(item, info.duration);
  if (!item.prompt.trim()) throw new Error('Describe the interstitial before generating.');
  onProgress('preparing', 0);
  const clip = await engine.exportMp4(range, { maxHeight: 768, frameRate: INTERSTITIAL.referenceFps, signal, onProgress: value => onProgress('preparing', value) });
  if (clip.size > INTERSTITIAL.maxReferenceBytes) throw new Error('The reference clip exceeds 50 MB. Shorten the reference ranges.');
  signal.throwIfAborted();
  const body = new FormData();
  body.set('video', clip, 'interstitial-reference.mp4');
  body.set('start', String(range.insertAt)); body.set('resume', String(range.resumeAt)); body.set('fps', String(range.fps)); body.set('prompt', item.prompt.trim());
  onProgress('uploading');
  return sendForm<FalJob>('/api/interstitials', body, signal);
}
export const getInterstitialJob = (id: string, signal?: AbortSignal) => request<FalJob>(`/api/fal/jobs/${encodeURIComponent(id)}`, { signal });
export const cancelInterstitialJob = (id: string) => request<FalJob>(`/api/fal/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
