import { BufferTarget, Conversion, EncodedPacketSink, Mp4InputFormat, Mp4OutputFormat, Output } from 'mediabunny';
import { ensureAac, openInput, type MediaInfo, type MediaSource } from './media';
import { generatedClipFit } from './videoFraming';
import { readAsset, readPlayback, writePlayback } from '../features/project/database';

/** Only generated assets enter this converter. Native source footage never does. */
export class GeneratedPlaybackMedia {
  private operation = new AbortController();
  private pending = new Map<string, Promise<string>>();
  private urls: string[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private info: MediaInfo, private matchFraming: boolean) {}
  resolve(source: MediaSource, onProgress?: (progress: number) => void): Promise<string> {
    const width = Math.max(2, Math.round(this.info.width / 2) * 2), height = Math.max(2, Math.round(this.info.height / 2) * 2);
    const fps = this.info.fps > 0 && Number.isFinite(this.info.fps) ? this.info.fps : 24;
    const identity = source.assetId ?? source.url;
    let task = this.pending.get(identity);
    if (!task) {
      task = this.queue.catch(() => undefined).then(async () => {
        const signal = this.operation.signal; signal.throwIfAborted();
        const original = source.file ?? (source.assetId ? (await readAsset(source.assetId))?.blob : undefined);
        const fingerprint = original ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await original.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('') : identity;
        const key = JSON.stringify(['native-generated-v1', fingerprint, width, height, fps, this.matchFraming]);
        const cached = await readPlayback(key).catch(() => undefined);
        signal.throwIfAborted();
        const blob = cached ?? await this.convert(source, width, height, fps, onProgress);
        signal.throwIfAborted();
        if (!blob) return source.url;
        if (!cached) await writePlayback(key, blob).catch(() => undefined); // Quota cannot prevent playback.
        signal.throwIfAborted();
        const url = URL.createObjectURL(blob); this.urls.push(url); return url;
      });
      this.pending.set(identity, task); this.queue = task.catch(() => undefined);
    }
    return task;
  }
  private async convert(source: MediaSource, width: number, height: number, fps: number, onProgress?: (progress: number) => void) {
    const signal = this.operation.signal, input = openInput(source);
    let conversion: Conversion | undefined;
    const abort = () => { if (conversion) void conversion.cancel().catch(() => undefined); else input.dispose(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const video = await input.getPrimaryVideoTrack();
      if (!video) throw new Error(`No video was found in ${source.name}.`);
      const audio = await input.getPrimaryAudioTrack();
      if (await input.getFormat() instanceof Mp4InputFormat && await video.getCodec() === 'avc' && (!audio || await audio.getCodec() === 'aac')
        && await video.getDisplayWidth() === width && await video.getDisplayHeight() === height) {
        let compatible = true;
        const frames = new Set<number>();
        for await (const packet of new EncodedPacketSink(video).packets(undefined, undefined, { metadataOnly: true })) {
          signal.throwIfAborted(); const frame = Math.round(packet.timestamp * fps);
          if (frame < 0 || frames.has(frame) || Math.abs(packet.timestamp * fps - frame) > .001 || Math.abs(packet.duration * fps - 1) > .001) { compatible = false; break; }
          frames.add(frame);
        }
        if (compatible && frames.has(0) && [...frames].every(frame => frame < frames.size)) return null;
      }
      const fit = this.matchFraming ? generatedClipFit(await video.getDisplayWidth(), await video.getDisplayHeight(), width, height) : 'contain';
      await ensureAac(); signal.throwIfAborted();
      const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
      conversion = await Conversion.init({ input, output, tracks: 'primary', trim: { start: 0, end: await video.computeDuration() },
        video: { codec: 'avc', width, height, fit, frameRate: fps, forceTranscode: true, keyFrameInterval: 1 }, audio: { codec: 'aac' } });
      signal.throwIfAborted();
      if (!conversion.isValid || conversion.discardedTracks.some(track => track.reason !== 'discarded_by_user')) throw new Error(`Unable to prepare ${source.name} for native playback.`);
      if (onProgress) conversion.onProgress = onProgress;
      await conversion.execute(); signal.throwIfAborted();
      if (!output.target.buffer) throw new Error(`No playback video was produced for ${source.name}.`);
      return new Blob([output.target.buffer], { type: 'video/mp4' });
    } finally {
      signal.removeEventListener('abort', abort);
      if (conversion && conversion.state !== 'done') await conversion.cancel().catch(() => undefined);
      input.dispose();
    }
  }
  dispose() { this.operation.abort(); this.urls.forEach(URL.revokeObjectURL); this.urls = []; }
}
