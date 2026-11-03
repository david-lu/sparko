import { ALL_FORMATS, BlobSource, BufferTarget, Input, Mp4OutputFormat, Output } from 'mediabunny';
import { COMFY, TIMELINE_FPS } from '../../../shared/constants';
import type { InterstitialResult } from '../../../shared/interstitials';
import { renderComposition } from '../../media/CompositionRenderer';
import { MediaEngine } from '../../media/MediaEngine';
import { CLIP_METADATA_TAG } from '../../../shared/clip-metadata';

/** Extract the generated loop body without replacing its boundary frames. */
export async function finishLoop(blob: Blob, result: InterstitialResult, signal: AbortSignal): Promise<{ blob: Blob; result: InterstitialResult }> {
  const url = URL.createObjectURL(blob), source = { id: 'generated-loop', name: 'Generated loop', url };
  const engine = new MediaEngine(source), abort = () => engine.dispose();
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const info = await engine.inspect(), fps = TIMELINE_FPS, frames = Math.round(result.duration * fps);
    if (frames < 3 || result.start + result.duration > info.duration + 1 / fps) throw new Error('The generated loop is shorter than its expected boundaries.');
    const target = new BufferTarget(), output = new Output({ target, format: new Mp4OutputFormat({ fastStart: 'in-memory', metadataFormat: 'mdta' }) });
    const metadata = result.metadata ? { ...result.metadata, media: { start: 0, duration: frames / fps, totalDuration: frames / fps } } : undefined;
    if (metadata) {
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      try { const tags = await input.getMetadataTags(); output.setMetadataTags({ ...tags, raw: { ...tags.raw, [CLIP_METADATA_TAG]: JSON.stringify(metadata) } }); }
      finally { input.dispose(); }
    }
    await renderComposition({ info, fps, crossfade: false, segments: [
      { id: 'loop', kind: 'source', label: 'Idle', source, sourceStart: result.start, startFrame: 0, endFrame: frames, muted: true },
    ] }, output, { start: 0, end: frames / fps, signal, maxDimension: COMFY.maxDimension });
    return { blob: new Blob([target.buffer!], { type: 'video/mp4' }), result: { ...result, metadata, start: 0, duration: frames / fps, totalDuration: frames / fps } };
  } finally { signal.removeEventListener('abort', abort); engine.dispose(); URL.revokeObjectURL(url); }
}
