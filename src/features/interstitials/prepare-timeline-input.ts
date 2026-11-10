import { BufferTarget, Mp4OutputFormat, Output } from 'mediabunny';
import { TIMELINE_FPS } from '../../../shared/constants';
import type { InterstitialSettings } from '../../../shared/interstitials';
import { validateTimelineVideos } from '../../../shared/video-references';
import type { comfyBridgePlan } from '../../../shared/comfy';
import { renderComposition } from '../../media/CompositionRenderer';
import type { TimelineSegment } from '../../media/TimelineComposition';
import { assets } from '../project/assets';
import type { AudioLayer } from '../../media/CompositionAudioLayers';
import { audibleClips } from '../../../shared/audio-tracks';

/** A full-clock input movie: connected references, inserted videos, and silent black gaps.
 * Preserved images are injected at pixel-frame positions by the workflow before VAE encoding.
 */
export async function prepareTimelineInput(reference: Blob | undefined, item: InterstitialSettings, plan: ReturnType<typeof comfyBridgePlan>,
  dimensions: { width: number; height: number }, signal: AbortSignal, onProgress: (value: number) => void) {
  const clips = validateTimelineVideos(item.timelineVideos, plan.middleFrames);
  const urls: string[] = [];
  try {
    const canvas = new OffscreenCanvas(2, 2); canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
    const blank = URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' })); urls.push(blank);
    const referenceUrl = reference ? URL.createObjectURL(reference) : undefined;
    if (referenceUrl) urls.push(referenceUrl);
    const inputs: TimelineSegment[] = [];
    if (referenceUrl && plan.prefixFrames) inputs.push({ id: 'start', kind: 'source', label: 'Start video', source: { id: 'reference', name: 'Reference', url: referenceUrl }, sourceStart: 0, startFrame: 0, endFrame: plan.prefixFrames });
    for (const clip of clips) {
      const { url } = await assets.open(clip.video!.assetId); signal.throwIfAborted();
      inputs.push({ id: clip.id, kind: 'source', label: clip.video!.name, source: { id: clip.video!.assetId, assetId: clip.video!.assetId, name: clip.video!.name, url, volume: clip.volume }, sourceStart: clip.video!.inFrame / TIMELINE_FPS,
        startFrame: plan.prefixFrames + clip.frame, endFrame: plan.prefixFrames + clip.frame + clip.video!.outFrame - clip.video!.inFrame });
    }
    if (referenceUrl && plan.suffixFrames) inputs.push({ id: 'end', kind: 'source', label: 'End video', source: { id: 'reference', name: 'Reference', url: referenceUrl }, sourceStart: plan.prefixFrames / TIMELINE_FPS, startFrame: plan.totalFrames - plan.suffixFrames, endFrame: plan.totalFrames });
    const segments: TimelineSegment[] = []; let cursor = 0;
    const gap = (end: number) => { if (end > cursor) segments.push({ id: `gap:${cursor}`, kind: 'source', label: 'Generated region', source: { id: 'blank', name: 'Blank', url: blank, kind: 'image' }, sourceStart: 0, startFrame: cursor, endFrame: end, still: true, muted: true }); };
    for (const input of inputs.sort((a, b) => a.startFrame - b.startFrame)) { gap(input.startFrame); segments.push(input); cursor = input.endFrame; }
    gap(plan.totalFrames);
    // Added sound is mixed over footage audio and silent gaps on the same full-render clock.
    const audioLayers: AudioLayer[] = [];
    for (const { clip, startFrame, endFrame, inFrame, volume } of audibleClips(item.inputAudioTracks, plan.prefixFrames, plan.totalFrames)) {
      await assets.open(clip.assetId); signal.throwIfAborted();
      audioLayers.push({ id: crypto.randomUUID(), assetId: clip.assetId, name: clip.name, startFrame, inFrame, outFrame: inFrame + endFrame - startFrame, volume, muted: false });
    }
    const duration = plan.totalFrames / TIMELINE_FPS, target = new BufferTarget(), output = new Output({ target, format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    await renderComposition({ segments, audioLayers, fps: TIMELINE_FPS, crossfade: false, info: { ...dimensions, duration, fps: TIMELINE_FPS, codec: '', hasAudio: true } }, output,
      { start: 0, end: duration, frame: { ...dimensions, fit: 'cover' }, signal, onProgress });
    return new Blob([target.buffer!], { type: 'video/mp4' });
  } finally { urls.forEach(url => URL.revokeObjectURL(url)); }
}
