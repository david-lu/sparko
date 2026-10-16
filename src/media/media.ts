import {
  ALL_FORMATS, BlobSource, BufferTarget, CanvasSink, Conversion, Input,
  Mp4OutputFormat, Output, UrlSource, WavOutputFormat, canEncodeAudio, type OutputFormat,
} from 'mediabunny';
import { validateSlice, type Slice } from '../../shared/contracts';

export type MediaSource = { id: string; name: string; url: string; file?: File; assetId?: string };
export type MediaInfo = { duration: number; width: number; height: number; codec: string; fps: number; hasAudio: boolean };
export type Thumbnail = { time: number; url: string };
type TaskOptions = { signal?: AbortSignal; onProgress?: (progress: number) => void };

export function openInput(source: MediaSource): Input {
  return new Input({
    formats: ALL_FORMATS,
    source: source.file ? new BlobSource(source.file) : new UrlSource(new URL(source.url, location.href).href),
  });
}

export async function inspectMedia(source: MediaSource): Promise<MediaInfo> {
  const input = openInput(source);
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('This file has no video track.');
    const [duration, width, height, codec, audio, stats] = await Promise.all([
      input.computeDuration(), video.getDisplayWidth(), video.getDisplayHeight(),
      video.getCodec(), input.getPrimaryAudioTrack(), video.computePacketStats(100),
    ]);
    return { duration, width, height, codec: codec || 'unknown', hasAudio: !!audio, fps: stats.averagePacketRate || 30 };
  } finally { input.dispose(); }
}

function jpeg(canvas: HTMLCanvasElement | OffscreenCanvas): string {
  const target = document.createElement('canvas');
  target.width = canvas.width;
  target.height = canvas.height;
  const context = target.getContext('2d');
  if (!context) throw new Error('Your browser cannot create a video thumbnail.');
  context.drawImage(canvas, 0, 0);
  return target.toDataURL('image/jpeg', 0.75);
}

export async function sampleFrames(source: MediaSource, slice: Slice, count: number, width = 768, signal?: AbortSignal): Promise<Thumbnail[]> {
  const input = openInput(source);
  const abort = () => input.dispose();
  signal?.throwIfAborted();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const duration = await input.computeDuration();
    validateSlice(slice, duration);
    const video = await input.getPrimaryVideoTrack();
    if (!video || !await video.canDecode()) throw new Error('This browser cannot decode this video for analysis. Try Chrome or Edge with an H.264 MP4.');
    const sink = new CanvasSink(video, { width, fit: 'contain', poolSize: 1 });
    const length = Math.min(24, Math.max(1, Math.floor(count)));
    const times = Array.from({ length }, (_, index) => slice.start + (slice.end - slice.start) * (index + 0.5) / length);
    const frames: Thumbnail[] = [];
    let index = 0;
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      signal?.throwIfAborted();
      if (frame) frames.push({ time: times[index], url: jpeg(frame.canvas) });
      index++;
    }
    if (!frames.length) throw new Error('No readable frames were found in this segment.');
    return frames;
  } finally {
    signal?.removeEventListener('abort', abort);
    input.dispose();
  }
}

let audioReady: Promise<void> | undefined;
export async function ensureAac() {
  audioReady ??= (async () => {
    if (!await canEncodeAudio('aac')) {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
      registerAacEncoder();
    }
  })();
  return audioReady;
}

async function runConversion(input: Input, output: Output<OutputFormat, BufferTarget>, conversion: Conversion, options: TaskOptions): Promise<Blob> {
  const abort = () => { void conversion.cancel().catch(() => undefined); };
  try {
    options.signal?.throwIfAborted();
    const missing = conversion.discardedTracks.filter(track => track.reason !== 'discarded_by_user');
    if (!conversion.isValid || missing.length) {
      throw new Error('This browser cannot encode all tracks in this clip. Try Chrome or Edge with an H.264 source. No incomplete export was created.');
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    conversion.onProgress = options.onProgress;
    await conversion.execute();
    options.signal?.throwIfAborted();
    if (!output.target.buffer) throw new Error('The video export produced no data.');
    return new Blob([output.target.buffer], { type: output.format.mimeType });
  } finally {
    options.signal?.removeEventListener('abort', abort);
    if (conversion.state !== 'done') await conversion.cancel().catch(() => undefined);
    input.dispose();
  }
}

/** Export an arbitrary range to H.264/AAC MP4. Deliberately has no download or editing UI. */
export async function exportMp4(source: MediaSource, slice: Slice, options: TaskOptions & { maxHeight?: number; frameRate?: number } = {}): Promise<Blob> {
  options.signal?.throwIfAborted();
  await ensureAac();
  const input = openInput(source);
  try {
    validateSlice(slice, await input.computeDuration());
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('This source has no video to export.');
    const sourceHeight = await track.getDisplayHeight();
    const target = new BufferTarget();
    const output = new Output({ target, format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    const conversion = await Conversion.init({
      input, output, tracks: 'primary', trim: slice,
      // Re-encode to honor arbitrary boundaries instead of expanding to nearby keyframes.
      video: { codec: 'avc', forceTranscode: true, frameRate: options.frameRate,
        ...(options.maxHeight && sourceHeight > options.maxHeight ? { height: options.maxHeight } : {}) },
      audio: { codec: 'aac', forceTranscode: true },
    });
    return await runConversion(input, output, conversion, options);
  } finally { input.dispose(); }
}

export async function extractAudio(source: MediaSource, slice: Slice, options: TaskOptions = {}): Promise<Blob | null> {
  const input = openInput(source);
  try {
    validateSlice(slice, await input.computeDuration(), 120);
    if (!await input.getPrimaryAudioTrack()) return null;
    const output = new Output({ target: new BufferTarget(), format: new WavOutputFormat() });
    const conversion = await Conversion.init({
      input, output, tracks: 'primary', trim: slice, video: { discard: true },
      audio: { codec: 'pcm-s16', numberOfChannels: 1, sampleRate: 16000 },
    });
    return await runConversion(input, output, conversion, options);
  } finally { input.dispose(); }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
