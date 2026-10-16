import { exportMp4, extractAudio, inspectMedia, sampleFrames, type MediaSource } from './media';
import type { Slice } from '../../shared/contracts';

/** One media source, with cancellable processing tasks that are released together. */
export class MediaEngine {
  private lifecycle = new AbortController();
  private metadata: ReturnType<typeof inspectMedia> | undefined;
  constructor(readonly source: MediaSource) {}

  inspect() { this.lifecycle.signal.throwIfAborted(); return this.metadata ??= inspectMedia(this.source); }
  private signal(signal?: AbortSignal) {
    return signal ? AbortSignal.any([signal, this.lifecycle.signal]) : this.lifecycle.signal;
  }
  frames(slice: Slice, count = 12, width = 768, signal?: AbortSignal) {
    return sampleFrames(this.source, slice, count, width, this.signal(signal));
  }
  async thumbnails() {
    const info = await this.inspect();
    return this.frames({ start: 0, end: info.duration }, 12, 180);
  }
  exportMp4(slice: Slice, options: Parameters<typeof exportMp4>[2] = {}) {
    return exportMp4(this.source, slice, { ...options, signal: this.signal(options.signal) });
  }
  audio(slice: Slice, signal?: AbortSignal) { return extractAudio(this.source, slice, { signal: this.signal(signal) }); }
  dispose() { this.lifecycle.abort(); this.metadata = undefined; }
}
