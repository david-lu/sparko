import { referenceClips, referenceWindow, referenceTiming } from '../../../shared/reference-clips';
export { referenceTiming } from '../../../shared/reference-clips';
import { BufferTarget, Mp4OutputFormat, Output } from 'mediabunny';
import { TIMELINE_FPS } from '../../../shared/constants';
import { comfyDimensions } from '../../../shared/comfy';
import type { GenerationReference, Interstitial } from '../../../shared/interstitials';
import { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import { renderComposition } from '../../media/CompositionRenderer';
import type { TimelineSegment } from '../../media/TimelineComposition';
import { assets } from '../project/assets';

/** Crop both reference windows to the project's H3 canvas before concatenating them. */
export async function generationSource<T extends Pick<Interstitial, 'time' | 'start_range' | 'end_range' | 'resolution'>>(item: T, input: GenerationReference, signal: AbortSignal, canvas?: Pick<MediaInfo, 'width' | 'height'> | null) {
  const timing = referenceTiming(item, input);
  const first = referenceClips(input, 'before')[0] ?? referenceClips(input, 'after')[0];
  if (!first) throw new Error('No reference footage to prepare.');
  const openedAssets = new Map<string, Awaited<ReturnType<typeof assets.open>>>();
  const open = async (id: string) => {
    let asset = openedAssets.get(id); if (!asset) { asset = await assets.open(id); openedAssets.set(id, asset); } return asset;
  };
  const before = await open(first.assetId);
  signal.throwIfAborted();
  const media = new MediaEngine({ id: first.assetId, name: 'Reference clip', url: before.url, kind: first.kind ?? (before.asset.blob.type.startsWith('image/') ? 'image' : undefined) });
  const abort = () => media.dispose(); signal.addEventListener('abort', abort, { once: true });
  let info;
  try { info = await media.inspect(); signal.throwIfAborted(); }
  finally { signal.removeEventListener('abort', abort); media.dispose(); }
  const dimensions = comfyDimensions(canvas?.width ?? info.width, canvas?.height ?? info.height, item.resolution);
  const referenceInfo = { ...info, ...dimensions, duration: timing.duration };
  const segments: TimelineSegment[] = [];
  let cursor = 0;
  const append = async (clips: typeof first[], side: string, still = false) => {
    for (const [index, clip] of clips.entries()) {
      const opened = await open(clip.assetId); signal.throwIfAborted();
      const image = clip.kind === 'image' || opened.asset.blob.type.startsWith('image/');
      const frames = still ? timing.after : clip.outFrame - clip.inFrame;
      segments.push({ id: `${side}:${index}`, kind: 'source', label: opened.asset.name,
        source: { id: clip.assetId, assetId: clip.assetId, name: opened.asset.name, url: opened.url, ...(image ? { kind: 'image' as const } : clip.kind==='audio'?{kind:'audio' as const}:{}) },
        sourceStart: image ? 0 : clip.inFrame / TIMELINE_FPS, startFrame: cursor, endFrame: cursor + frames,
        still: still || image, muted: still || image });
      cursor += frames;
    }
  };
  await append(referenceWindow(referenceClips(input, 'before'), timing.before, 'before'), 'before');
  if (timing.after) {
    if (input.mode === 'loop' || !input.after) {
      const last = referenceClips(input, 'before').at(-1) ?? first;
      await append([{ ...last, inFrame: last.outFrame - 1 }], 'after', true);
    } else await append(referenceWindow(referenceClips(input, 'after'), timing.after, 'after'), 'after');
  }
  const engine: Pick<MediaEngine, 'exportMp4'> = { exportMp4: async (slice, options = {}) => {
    const target = new BufferTarget(), output = new Output({ target, format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    await renderComposition({ info: referenceInfo, fps: TIMELINE_FPS, segments, crossfade: false }, output,
      { ...slice, signal, frame: options.frame ?? { ...dimensions, fit: 'cover' }, onProgress: options.onProgress });
    return new Blob([target.buffer!], { type: 'video/mp4' });
  } };
  return { engine, info: referenceInfo, item: { ...item, time: timing.time } };
}
