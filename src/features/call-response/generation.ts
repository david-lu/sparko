import { BufferTarget, Mp4OutputFormat, Output } from 'mediabunny';
import { TIMELINE_FPS } from '../../../shared/constants';
import type { GenerationReference, Interstitial } from '../../../shared/interstitials';
import { MediaEngine } from '../../media/MediaEngine';
import { renderComposition } from '../../media/CompositionRenderer';
import type { TimelineSegment } from '../../media/TimelineComposition';
import { assets } from '../project/assets';

export function referenceTiming(item: Interstitial, input: GenerationReference) {
  const before = Math.min(input.before.outFrame - input.before.inFrame, Math.ceil(item.start_range * TIMELINE_FPS));
  const after = input.mode === 'extend' ? 0 : Math.min(input.after && input.mode !== 'loop' ? input.after.outFrame - input.after.inFrame : Infinity, Math.ceil(item.end_range * TIMELINE_FPS));
  return { before, after, time: before / TIMELINE_FPS, duration: (before + after) / TIMELINE_FPS };
}

/** Compose the preceding clip's tail and the return context without changing source assets. */
export async function generationSource(item: Interstitial, input: GenerationReference, signal: AbortSignal) {
  const timing = referenceTiming(item, input);
  const before = await assets.open(input.before.assetId);
  signal.throwIfAborted();
  const media = new MediaEngine({ id: input.before.assetId, name: 'Previous clip', url: before.url });
  const abort = () => media.dispose(); signal.addEventListener('abort', abort, { once: true });
  let info;
  try { info = await media.inspect(); signal.throwIfAborted(); }
  finally { signal.removeEventListener('abort', abort); media.dispose(); }
  const after = input.after ? await assets.open(input.after.assetId) : before;
  signal.throwIfAborted();
  const segments: TimelineSegment[] = [
    { id: 'before', kind: 'source', label: 'Previous clip', source: { id: input.before.assetId, name: 'Previous clip', url: before.url },
      sourceStart: (input.before.outFrame - timing.before) / TIMELINE_FPS, startFrame: 0, endFrame: timing.before },
    ...(timing.after ? [{ id: 'after', kind: 'source' as const, label: 'Return context', source: { id: input.after?.assetId ?? input.before.assetId, name: 'Return context', url: after.url },
      sourceStart: (input.mode === 'loop' ? input.before.outFrame - 1 : input.after?.inFrame ?? input.before.outFrame - 1) / TIMELINE_FPS, startFrame: timing.before, endFrame: timing.before + timing.after, still: !input.after || input.mode === 'loop' },
    ] : []),
  ];
  const engine: Pick<MediaEngine, 'exportMp4'> = { exportMp4: async (slice, options = {}) => {
    const target = new BufferTarget(), output = new Output({ target, format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    await renderComposition({ info, fps: TIMELINE_FPS, segments }, output, { ...slice, signal, preview: true, onProgress: options.onProgress });
    return new Blob([target.buffer!], { type: 'video/mp4' });
  } };
  return { engine, info: { ...info, duration: timing.duration }, item: { ...item, time: timing.time } };
}
