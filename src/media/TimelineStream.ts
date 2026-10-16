import { AppendOnlyStreamTarget, BufferTarget, Mp4OutputFormat, Output } from 'mediabunny';
import { COMPOSITION_MIME, renderComposition } from './CompositionRenderer';
import type { TimelineComposition } from './TimelineComposition';

const delay = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(finish, 100);
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  signal.addEventListener('abort', abort, { once: true });
});

/** Bounded, progressive fMP4 preview. One native video element crosses every splice. */
export class TimelineStream {
  private operation: AbortController | null = null;
  private url: string | null = null;
  constructor(readonly composition: TimelineComposition) {}

  dispose() {
    this.operation?.abort(); this.operation = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  start(element: HTMLVideoElement, requested: number, onReady: () => void, onError: (error: Error) => void) {
    this.dispose();
    const operation = new AbortController(); this.operation = operation;
    const { signal } = operation;
    const { composition } = this;
    const start = Math.min(composition.duration - 1 / composition.fps, Math.max(0, Math.floor(requested * composition.fps) / composition.fps));
    const fail = (error: unknown) => { if (!signal.aborted) { operation.abort(); onError(error instanceof Error ? error : new Error('Timeline playback failed.')); } };
    const canplay = () => { if (!signal.aborted) onReady(); };
    element.addEventListener('canplay', canplay, { once: true, signal });
    if (!('MediaSource' in window) || !MediaSource.isTypeSupported(COMPOSITION_MIME)) {
      void this.exportMp4({ start: 0, end: composition.duration }, signal).then(blob => {
        if (signal.aborted) return;
        this.url = URL.createObjectURL(blob); element.src = this.url;
        element.addEventListener('loadedmetadata', () => { element.currentTime = requested; }, { once: true, signal });
        element.load();
      }).catch(fail);
      return;
    }
    const media = new MediaSource();
    this.url = URL.createObjectURL(media);
    element.src = this.url; element.load();
    media.addEventListener('sourceopen', () => {
      if (signal.aborted) return;
      let buffer: SourceBuffer;
      try {
        buffer = media.addSourceBuffer(COMPOSITION_MIME);
        buffer.timestampOffset = start;
        buffer.appendWindowEnd = composition.duration;
        media.duration = composition.duration;
      } catch (error) { fail(error); return; }
      const update = (action: () => void) => new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const cleanup = () => { buffer.removeEventListener('updateend', done); buffer.removeEventListener('error', error); signal.removeEventListener('abort', abort); };
        const done = () => { cleanup(); resolve(); };
        const error = () => { cleanup(); reject(new Error('Unable to buffer the composed timeline.')); };
        const abort = () => { cleanup(); reject(signal.reason); };
        buffer.addEventListener('updateend', done, { once: true }); buffer.addEventListener('error', error, { once: true }); signal.addEventListener('abort', abort, { once: true });
        try { action(); } catch (cause) { cleanup(); reject(cause); }
      });
      let positioned = false;
      const writable = new WritableStream<Uint8Array>({ write: async chunk => {
        signal.throwIfAborted();
        if (element.currentTime > start + 20 && buffer.buffered.length && buffer.buffered.start(0) < element.currentTime - 20) {
          await update(() => buffer.remove(0, element.currentTime - 15));
        }
        await update(() => buffer.appendBuffer(Uint8Array.from(chunk)));
        if (!positioned && buffer.buffered.length) { positioned = true; element.currentTime = requested < composition.duration ? requested : Math.max(start, composition.duration - 1 / composition.fps); }
      } });
      const output = new Output({ target: new AppendOnlyStreamTarget(writable), format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 0.5 }) });
      void renderComposition(composition, output, { start, end: composition.duration, signal, preview: true,
        beforeFrame: async time => {
          while (time > Math.max(start, element.currentTime) + 8) { signal.throwIfAborted(); await delay(signal); }
        },
      }).then(() => { if (!signal.aborted && media.readyState === 'open') { media.duration = composition.duration; media.endOfStream(); } }).catch(fail);
    }, { once: true, signal });
  }

  async exportMp4(range: { start: number; end: number }, signal = new AbortController().signal, onProgress?: (progress: number) => void) {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end > this.composition.duration || range.end <= range.start) throw new Error('Choose a valid timeline range.');
    if (Math.round(range.end * this.composition.fps) <= Math.round(range.start * this.composition.fps)) throw new Error('Select at least one video frame.');
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    await renderComposition(this.composition, output, { ...range, signal, onProgress });
    if (!output.target.buffer) throw new Error('The timeline export produced no video.');
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  }
}
