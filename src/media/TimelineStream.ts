import { BufferTarget, Mp4OutputFormat, Output } from 'mediabunny';
import { renderComposition } from './CompositionRenderer';
import type { TimelineComposition } from './TimelineComposition';

/** Explicit composed exports. Playback uses native clips and never calls this encoder. */
export class TimelineStream {
  constructor(readonly composition: TimelineComposition) {}
  async exportMp4(range: { start: number; end: number }, signal = new AbortController().signal, onProgress?: (progress: number) => void) {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end > this.composition.duration || range.end <= range.start) throw new Error('Choose a valid timeline range.');
    if (Math.round(range.end * this.composition.fps) <= Math.round(range.start * this.composition.fps)) throw new Error('Select at least one video frame.');
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    await renderComposition(this.composition, output, { ...range, signal, onProgress });
    if (!output.target.buffer) throw new Error('The timeline export produced no video.');
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  }
}
