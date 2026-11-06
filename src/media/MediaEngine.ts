import { exportMp4, extractAudio, inspectMedia, sampleFrames, type MediaSource } from './media';
import type { Slice } from '../../shared/contracts';
import { assetThumbnails } from './assetThumbnails';

/** One media source, with cancellable processing tasks that are released together. */
export class MediaEngine {
  private lifecycle = new AbortController();
  private metadata: ReturnType<typeof inspectMedia> | undefined;
  constructor(readonly source: MediaSource) {}

  inspect(signal?: AbortSignal) {
    const operation = this.signal(signal); operation.throwIfAborted();
    // Caller cancellation must not poison the shared metadata promise.
    if (signal) return inspectMedia(this.source, operation);
    if (!this.metadata) {
      const pending = inspectMedia(this.source, operation);
      this.metadata = pending;
      void pending.catch(() => { if (this.metadata === pending) this.metadata = undefined; });
    }
    return this.metadata;
  }
  private signal(signal?: AbortSignal) {
    return signal ? AbortSignal.any([signal, this.lifecycle.signal]) : this.lifecycle.signal;
  }
  frames(slice: Slice, count = 12, width = 768, signal?: AbortSignal) {
    return sampleFrames(this.source, slice, count, width, this.signal(signal));
  }
  async thumbnails() {
    const info = await this.inspect();
    return assetThumbnails(this.source, info.duration);
  }
  exportMp4(slice: Slice, options: Parameters<typeof exportMp4>[2] = {}) {
    return exportMp4(this.source, slice, { ...options, signal: this.signal(options.signal) });
  }
  audio(slice: Slice, signal?: AbortSignal) { return extractAudio(this.source, slice, { signal: this.signal(signal) }); }
  dispose() { this.lifecycle.abort(); this.metadata = undefined; }
}
