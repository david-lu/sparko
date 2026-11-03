import { INTERSTITIAL, MASK_TRANSITION } from '../../../shared/constants';
import type { GenerationJob } from '../../../shared/contracts';
import { clipMaskInjection, validateMaskTransitionMs, type Interstitial } from '../../../shared/interstitials';
import { comfyDimensions, comfyReferenceRange } from '../../../shared/comfy';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import { request, sendForm } from '../../shared/api';
import { referenceImageData } from './image-references';
import { assets } from '../project/assets';

export const hasImageOnlyInput = (item: Interstitial) => !!item.imageReferences?.length && item.useInputReference === false && item.useOutputReference === false;

export async function generateInterstitial(item: Interstitial, engine: Pick<MediaEngine, 'exportMp4'> | null, info: MediaInfo | null, signal: AbortSignal,
  onProgress: (phase: 'preparing' | 'uploading', fraction?: number) => void): Promise<GenerationJob> {
  const audioMaskTransitionMs = item.audioMaskTransitionMs ?? item.maskTransitionMs ?? MASK_TRANSITION.defaultMs;
  const videoMaskTransitionMs = item.videoMaskTransitionMs ?? item.maskTransitionMs ?? MASK_TRANSITION.defaultMs;
  validateMaskTransitionMs(audioMaskTransitionMs, 'Audio mask transition');
  validateMaskTransitionMs(videoMaskTransitionMs, 'Video mask transition');
  const query = new URLSearchParams();
  if (item.resolution === '2k') query.set('resolution', '2k');
  if (item.imageReferences?.length) query.set('imageReferences', 'true');
  if (item.method === 'comfy-loop' && hasImageOnlyInput(item)) query.set('imageLoop', 'true');
  const readiness = await request<{ ready: boolean; message?: string }>(`/api/comfy/status${query.size ? `?${query}` : ''}`, { signal });
  if (!readiness.ready) throw new Error(readiness.message || 'Comfy Cloud is not ready.');
  if ((!engine || !info) && !hasImageOnlyInput(item)) throw new Error('Load the source video or add image references and turn off Start and End references.');
  const range = comfyReferenceRange(item, info?.duration ?? item.duration);
  if (!item.prompt.trim()) throw new Error('Describe the interstitial before generating.');
  onProgress('preparing', 0);
  const images = await referenceImageData(item.imageReferences, signal);
  let canvas = info;
  if (!canvas) {
    const { asset } = await assets.open(item.imageReferences![0].assetId), bitmap = await createImageBitmap(asset.blob);
    try { canvas = { width: bitmap.width, height: bitmap.height, duration: item.duration, fps: INTERSTITIAL.referenceFps, hasAudio: false, codec: '' }; }
    finally { bitmap.close(); }
  }
  signal.throwIfAborted();
  const dimensions = comfyDimensions(canvas.width, canvas.height, item.resolution);
  const clip = range.plan.prefixFrames || range.plan.suffixFrames ? await engine!.exportMp4(range, { maxDimension: Math.max(dimensions.width, dimensions.height), frameRate: INTERSTITIAL.referenceFps,
    quality: 'high', signal, onProgress: value => onProgress('preparing', value) }) : undefined;
  if (clip && clip.size > INTERSTITIAL.maxReferenceBytes) throw new Error('The reference clip exceeds 50 MB. Shorten the reference ranges.');
  signal.throwIfAborted();
  const body = new FormData();
  if (images.length) body.set('imageReferences', JSON.stringify(images));
  if (clip) body.set('video', clip, 'comfy-reference.mp4');
  else { body.set('width', String(dimensions.width)); body.set('height', String(dimensions.height)); }
  body.set('before', String(range.insertAt)); body.set('after', String(range.after));
  body.set('duration', String(item.duration)); body.set('prompt', item.prompt);
  body.set('mode', range.mode);
  body.set('maskInjection', clipMaskInjection(item));
  body.set('audioMaskTransitionMs', String(audioMaskTransitionMs));
  body.set('videoMaskTransitionMs', String(videoMaskTransitionMs));
  body.set('resolution', item.resolution ?? 'native');
  onProgress('uploading');
  return sendForm<GenerationJob>('/api/comfy/interstitials', body, signal);
}
export const getInterstitialJob = (id: string, signal?: AbortSignal) => request<GenerationJob>(`/api/comfy/jobs/${encodeURIComponent(id)}`, { signal });
export const cancelInterstitialJob = (id: string) => request<GenerationJob>(`/api/comfy/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
