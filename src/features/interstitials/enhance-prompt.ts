import { TIMELINE_FPS } from '../../../shared/constants';
import type { PromptClipKind, PromptEnhancement } from '../../../shared/contracts';
import type { GenerationReference, Interstitial } from '../../../shared/interstitials';
import { sampleFrame, type MediaInfo } from '../../media/media';
import type { MediaEngine } from '../../media/MediaEngine';
import { request } from '../../shared/api';
import { assets } from '../project/assets';

export async function enhancePrompt(item: Pick<Interstitial, 'prompt' | 'time' | 'duration' | 'continuity' | 'dialogue'>, kind: PromptClipKind, reference: GenerationReference | undefined,
  engine: MediaEngine | null, info: MediaInfo | null, signal: AbortSignal, target?: 'continuity') {
  const referenceFrames: string[] = [];
  if (reference) {
    const before = await assets.open(reference.before.assetId);
    referenceFrames.push((await sampleFrame({ id: reference.before.assetId, name: 'Preceding clip', url: before.url }, (reference.before.outFrame - 1) / TIMELINE_FPS, 512, signal)).url);
    if (reference.after) {
      const after = await assets.open(reference.after.assetId);
      referenceFrames.push((await sampleFrame({ id: reference.after.assetId, name: 'Following clip', url: after.url }, (reference.mode === 'loop' ? reference.after.outFrame - 1 : reference.after.inFrame) / TIMELINE_FPS, 512, signal)).url);
    }
  } else if (engine && info) {
    const last = Math.max(0, info.duration - 1 / info.fps);
    for (const time of [Math.max(0, Math.min(last, item.time - 1 / TIMELINE_FPS)), Math.max(0, Math.min(last, item.time))]) {
      referenceFrames.push((await sampleFrame(engine.source, time, 512, signal)).url);
    }
  }
  signal.throwIfAborted();
  return request<PromptEnhancement>('/api/interstitials/enhance-prompt', { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: item.prompt, duration: item.duration, kind, target, referenceFrames, continuity: item.continuity, dialogue: item.dialogue }) });
}
