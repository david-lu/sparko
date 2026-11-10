import { COMFY, TIMELINE_FPS } from '../../../shared/constants';
import { comfyStepProgress } from '../../../shared/comfy-progress';
import { playableResult, type Interstitial, type InterstitialResult, type UpscaleJob } from '../../../shared/interstitials';

export type UpscaleSource = { result: InterstitialResult; assetId: string; frames: number; prompt: string; preservedFrames: number[] };

/** The complete native render shown in the Generated tab, with the exact prompt it was made from. */
export function upscaleSource(item: Interstitial): UpscaleSource | { error: string } {
  const result = playableResult(item), assetId = result?.fullAssetId ?? result?.assetId;
  if (!result || !assetId) return { error: 'Generate a video first, then upscale it to 2K.' };
  const frames = Math.round((result.fullRange?.totalDuration ?? result.totalDuration) * TIMELINE_FPS);
  if (frames < COMFY.minRegenerationFrames) return { error: 'H3 2K regeneration needs at least 4.46 seconds, including reference footage. Increase the duration and regenerate.' };
  if (frames > COMFY.maxFrames) return { error: 'H3 2K regeneration supports up to 362 frames.' };
  const current = result === item.result && item.phase === 'ready';
  const prompt = result.prompt ?? result.metadata?.prompt ?? (current ? item.requestPrompt : undefined);
  if (!prompt?.trim()) return { error: 'This video has no saved prompt. Regenerate it to upscale at 2K.' };
  const settings = result.metadata?.settings ?? (current ? item.generationSettings : undefined);
  const prefix = Math.round((result.fullRange?.start ?? result.start) * TIMELINE_FPS);
  // Exact-frame keyframes were spliced into the native render; the 2K pass restores them.
  const preservedFrames = (settings?.keyframes ?? []).filter(k => k.enabled && k.image && k.method === 'frame').map(k => prefix + k.frame).filter(frame => frame < frames);
  return { result, assetId, frames, prompt, preservedFrames };
}

export function upscaleLabel(job: UpscaleJob) {
  switch (job.phase) {
    case 'preparing': return 'Reading generated video';
    case 'uploading': return 'Uploading video for 2K';
    case 'queued': return job.queuePosition === undefined ? 'Queued for 2K' : `Queued for 2K · position ${job.queuePosition + 1}`;
    case 'rendering': {
      const progress = comfyStepProgress(job.progressDetails);
      return `${progress === undefined ? '' : `${Math.round(progress * 100)}% · `}${job.progressDetails?.stage || 'Regenerating with H3 2K'}`;
    }
    case 'loading': return `${job.progressDetails?.stage || 'Downloading 2K video'}${job.progress === undefined ? '' : ` · ${Math.round(job.progress * 100)}%`}`;
    case 'error': return job.error || 'The 2K upscale failed. Try again.';
    case 'cancelled': return '2K upscale cancelled.';
  }
}
