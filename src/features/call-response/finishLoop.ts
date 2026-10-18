import { BufferTarget, Mp4OutputFormat, Output } from 'mediabunny';
import { COMFY, TIMELINE_FPS } from '../../../shared/constants';
import type { InterstitialResult } from '../../../shared/interstitials';
import { renderComposition } from '../../media/CompositionRenderer';
import { MediaEngine } from '../../media/MediaEngine';

/** Extract the generated loop body without replacing its boundary frames. */
export async function finishLoop(blob: Blob, result: InterstitialResult, signal: AbortSignal) {
  const url = URL.createObjectURL(blob), source = { id: 'generated-loop', name: 'Generated loop', url };
  const engine = new MediaEngine(source), abort = () => engine.dispose();
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const info = await engine.inspect(), fps = TIMELINE_FPS, frames = Math.round(result.duration * fps);
    if (frames < 3 || result.start + result.duration > info.duration + 1 / fps) throw new Error('The generated loop is shorter than its expected boundaries.');
    const target = new BufferTarget(), output = new Output({ target, format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    await renderComposition({ info, fps, crossfade: false, segments: [
      { id: 'loop', kind: 'source', label: 'Idle', source, sourceStart: result.start, startFrame: 0, endFrame: frames, muted: true },
    ] }, output, { start: 0, end: frames / fps, signal, maxDimension: COMFY.maxDimension });
    return { blob: new Blob([target.buffer!], { type: 'video/mp4' }), result: { ...result, start: 0, duration: frames / fps, totalDuration: frames / fps } };
  } finally { signal.removeEventListener('abort', abort); engine.dispose(); URL.revokeObjectURL(url); }
}
