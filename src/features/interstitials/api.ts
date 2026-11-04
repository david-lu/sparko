import { INTERSTITIAL, MASK_TRANSITION } from '../../../shared/constants';
import type { GenerationJob } from '../../../shared/contracts';
import { clipMaskInjection, validateMaskTransitionMs, type Interstitial } from '../../../shared/interstitials';
import { comfyDimensions, comfyReferenceRange } from '../../../shared/comfy';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import { request, sendForm } from '../../shared/api';
import { referenceImageData } from './image-references';
import { assets } from '../project/assets';
import { maskCurveSchema } from '../../../shared/mask-curves';

export const hasNoVideoInput = (item: Interstitial) => item.useInputReference === false && item.useOutputReference === false;

export async function generateInterstitial(item: Interstitial, engine: Pick<MediaEngine, 'exportMp4'> | null, info: MediaInfo | null, signal: AbortSignal,
  onProgress: (phase: 'preparing' | 'uploading', fraction?: number) => void): Promise<GenerationJob> {
  const audioMaskTransitionMs = item.audioMaskTransitionMs ?? item.maskTransitionMs ?? MASK_TRANSITION.defaultMs;
  const videoMaskTransitionMs = item.videoMaskTransitionMs ?? item.maskTransitionMs ?? MASK_TRANSITION.defaultMs;
  validateMaskTransitionMs(audioMaskTransitionMs, 'Audio mask transition');
  validateMaskTransitionMs(videoMaskTransitionMs, 'Video mask transition');
  for (const curve of [item.audioMaskCurve, item.videoMaskCurve]) if (curve) maskCurveSchema.parse(curve);
  const query = new URLSearchParams();
  if (item.resolution === '2k') query.set('resolution', '2k');
  if (item.imageReferences?.length) query.set('imageReferences', 'true');
  const startImageIndex = item.useInputReference === false ? item.startImageIndex : undefined;
  const endImageIndex = item.useOutputReference === false ? item.endImageIndex : undefined;
  for (const index of [startImageIndex, endImageIndex]) {
    if (index !== undefined && !item.imageReferences?.[index]) throw new Error('Choose an image for each image reference before generating.');
  }
  if (startImageIndex !== undefined || endImageIndex !== undefined) query.set('imageGuides', 'true');
  if (item.method === 'comfy-loop' && startImageIndex !== undefined) query.set('imageLoop', 'true');
  const readiness = await request<{ ready: boolean; message?: string }>(`/api/comfy/status${query.size ? `?${query}` : ''}`, { signal });
  if (!readiness.ready) throw new Error(readiness.message || 'Comfy Cloud is not ready.');
  if ((!engine || !info) && !hasNoVideoInput(item)) throw new Error('Connect reference footage or set Start and End to None or Image.');
  const range = comfyReferenceRange(item, info?.duration ?? item.duration);
  if (!item.prompt.trim()) throw new Error('Describe the video before generating.');
  onProgress('preparing', 0);
  const images = await referenceImageData(item.imageReferences, signal);
  let canvas = info;
  if (!canvas && item.imageReferences?.length) {
    const { asset } = await assets.open(item.imageReferences![0].assetId), bitmap = await createImageBitmap(asset.blob);
    try { canvas = { width: bitmap.width, height: bitmap.height, duration: item.duration, fps: INTERSTITIAL.referenceFps, hasAudio: false, codec: '' }; }
    finally { bitmap.close(); }
  }
  canvas ??= { width: 1280, height: 720, duration: item.duration, fps: INTERSTITIAL.referenceFps, hasAudio: false, codec: '' };
  signal.throwIfAborted();
  const dimensions = comfyDimensions(canvas.width, canvas.height, item.resolution);
  // Crop directly to H3's exact canvas so its loader does not apply a second framing transform.
  const clip = range.plan.prefixFrames || range.plan.suffixFrames ? await engine!.exportMp4(range, { frame: { ...dimensions, fit: 'cover' }, frameRate: INTERSTITIAL.referenceFps,
    quality: 'high', signal, onProgress: value => onProgress('preparing', value) }) : undefined;
  if (clip && clip.size > INTERSTITIAL.maxReferenceBytes) throw new Error('The reference clip exceeds 50 MB. Shorten the reference ranges.');
  signal.throwIfAborted();
  const body = new FormData();
  if (images.length) body.set('imageReferences', JSON.stringify(images));
  if (startImageIndex !== undefined) body.set('startImageIndex', String(startImageIndex));
  if (endImageIndex !== undefined) body.set('endImageIndex', String(endImageIndex));
  if (clip) body.set('video', clip, 'comfy-reference.mp4');
  else { body.set('width', String(dimensions.width)); body.set('height', String(dimensions.height)); }
  body.set('before', String(range.insertAt)); body.set('after', String(range.after));
  body.set('duration', String(item.duration)); body.set('prompt', item.prompt);
  body.set('mode', range.mode);
  if (item.lora) body.set('lora', item.lora);
  if (range.mode === 'loop') body.set('loopImageGuide', String(startImageIndex !== undefined));
  body.set('maskInjection', clipMaskInjection(item));
  body.set('audioMaskTransitionMs', String(audioMaskTransitionMs));
  body.set('videoMaskTransitionMs', String(videoMaskTransitionMs));
  if (item.audioMaskCurve) body.set('audioMaskCurve', JSON.stringify(item.audioMaskCurve));
  if (item.videoMaskCurve) body.set('videoMaskCurve', JSON.stringify(item.videoMaskCurve));
  body.set('resolution', item.resolution ?? 'native');
  onProgress('uploading');
  return sendForm<GenerationJob>('/api/comfy/interstitials', body, signal);
}
export const getInterstitialJob = (id: string, signal?: AbortSignal) => request<GenerationJob>(`/api/comfy/jobs/${encodeURIComponent(id)}`, { signal });
export const cancelInterstitialJob = (id: string) => request<GenerationJob>(`/api/comfy/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
