import { BufferTarget, Mp4OutputFormat, Output } from 'mediabunny';
import { TIMELINE_FPS } from '../../../shared/constants';
import type { InterstitialResult } from '../../../shared/interstitials';
import { renderComposition } from '../../media/CompositionRenderer';
import { MediaEngine } from '../../media/MediaEngine';
import { assets } from '../project/assets';

/** Pin both visible boundaries to the same accepted Call frame, after model generation. */
export async function finishLoop(blob: Blob, result: InterstitialResult, signal: AbortSignal) {
  const reference = result.reference!.before, boundary = await assets.open(reference.assetId);
  const url = URL.createObjectURL(blob), source = { id: 'generated-loop', name: 'Generated loop', url };
  const engine = new MediaEngine(source), abort = () => engine.dispose();
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const info = await engine.inspect(), fps = TIMELINE_FPS, frames = Math.round(result.duration * fps);
    if (frames < 3 || result.start + result.duration > info.duration + 1 / fps) throw new Error('The generated loop is shorter than its expected boundaries.');
    const target = new BufferTarget(), output = new Output({ target, format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    const anchor = { kind: 'source' as const, label: 'Call ending', source: { id: reference.assetId, name: 'Call ending', url: boundary.url }, sourceStart: (reference.outFrame - 1) / fps, still: true, muted: true };
    await renderComposition({ info, fps, crossfade: false, segments: [
      { ...anchor, id: 'loop-start', startFrame: 0, endFrame: 1 },
      { id: 'loop', kind: 'source', label: 'Idle', source, sourceStart: result.start + 1 / fps, startFrame: 1, endFrame: frames - 1, muted: true },
      { ...anchor, id: 'loop-end', startFrame: frames - 1, endFrame: frames },
    ] }, output, { start: 0, end: frames / fps, signal });
    return { blob: new Blob([target.buffer!], { type: 'video/mp4' }), result: { ...result, start: 0, duration: frames / fps, totalDuration: frames / fps } };
  } finally { signal.removeEventListener('abort', abort); engine.dispose(); URL.revokeObjectURL(url); }
}
