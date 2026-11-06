import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, EncodedPacketSink, Input, Mp4InputFormat, Mp4OutputFormat, Output, Quality, type InputVideoTrack } from 'mediabunny';
import { TIMELINE_FPS, VIDEO_PREPARATION } from '../../shared/constants';
import { ensureAac } from './media';

/** Check the entire presentation clock, not just an average that can hide variable frame rates. */
async function hasFrameClock(track: InputVideoTrack, fps: number, signal: AbortSignal) {
  const frames = new Set<number>();
  for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
    signal.throwIfAborted();
    const frame = Math.round(packet.timestamp * fps);
    if (frame < 0 || Math.abs(packet.timestamp - frame / fps) > 1e-6
      || Math.abs(packet.duration - 1 / fps) > 1e-6 || frames.has(frame)) return false;
    frames.add(frame);
  }
  return frames.size > 0 && frames.has(0) && [...frames].every(frame => frame < frames.size);
}

/** Probe Mediabunny decoding without starting an encoder. */
export async function canPlaySourceVideo(blob: Blob, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const abort = () => input.dispose();
  signal.addEventListener('abort', abort, { once: true });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('This file has no video track.');
    const audio = await input.getPrimaryAudioTrack();
    const playable = await video.canDecode() && (!audio || await audio.canDecode());
    signal.throwIfAborted(); return playable;
  } catch (error) { signal.throwIfAborted(); throw error; }
  finally { signal.removeEventListener('abort', abort); input.dispose(); }
}

/** Optional import normalization preserves resolution; compatibility fallback keeps its size limit. */
export async function prepareSourceVideo(blob: Blob, signal: AbortSignal, onProgress: (progress: number) => void, convertTo24Fps = false): Promise<Blob> {
  if (convertTo24Fps) return convertVideoFrameRate(blob, TIMELINE_FPS, signal, onProgress);
  return await canPlaySourceVideo(blob, signal) ? blob : prepareVideo(blob, signal, onProgress, false);
}

/** Prepare a durable 24 fps working file. Compatible files are returned unchanged. */
export async function prepareVideo(blob: Blob, signal: AbortSignal, onProgress: (progress: number) => void, reuseCompatible = true, maxHeight: number = VIDEO_PREPARATION.maxHeight): Promise<Blob> {
  return convertVideo(blob, TIMELINE_FPS, signal, onProgress, reuseCompatible, maxHeight);
}

export type VideoDimensions = { width: number; height: number; fit: 'contain' | 'cover' | 'fill' };
export const validVideoDimensions = (size: VideoDimensions) => [size.width, size.height].every(n => Number.isInteger(n) && n >= 2 && n <= 8192 && n % 2 === 0);

/** Change frame cadence and optionally dimensions while preserving playback speed and the audio clock. */
export async function convertVideoFrameRate(blob: Blob, fps: number, signal: AbortSignal, onProgress: (progress: number) => void, dimensions?: VideoDimensions): Promise<Blob> {
  if (!Number.isFinite(fps) || fps < 1 || fps > 240) throw new Error('Choose a frame rate between 1 and 240 fps.');
  if (dimensions && !validVideoDimensions(dimensions)) throw new Error('Choose even dimensions between 2 and 8192 pixels.');
  return convertVideo(blob, fps, signal, onProgress, true, 0, dimensions);
}

async function convertVideo(blob: Blob, fps: number, signal: AbortSignal, onProgress: (progress: number) => void, reuseCompatible: boolean, maxHeight: number, dimensions?: VideoDimensions): Promise<Blob> {
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  let conversion: Conversion | undefined;
  let reportedPercent = -1;
  const reportProgress = (value: number) => {
    const percent = Math.floor(Math.max(0, Math.min(1, value)) * 100);
    if (percent !== reportedPercent) { reportedPercent = percent; onProgress(percent / 100); }
  };
  const abort = () => { if (conversion) void conversion.cancel().catch(() => undefined); else input.dispose(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('This file has no video track.');
    const audio = await input.getPrimaryAudioTrack();
    const sameSize = !dimensions || dimensions.width === await video.getDisplayWidth() && dimensions.height === await video.getDisplayHeight();
    if (reuseCompatible && sameSize && await input.getFormat() instanceof Mp4InputFormat && await video.getCodec() === 'avc'
      && (!audio || await audio.getCodec() === 'aac') && await hasFrameClock(video, fps, signal)) return blob;
    signal.throwIfAborted();
    reportProgress(0);
    await ensureAac();
    signal.throwIfAborted();
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory', metadataFormat: 'mdta' }) });
    conversion = await Conversion.init({ input, output, tracks: 'primary', trim: { start: 0 },
      video: { codec: 'avc', frameRate: fps, forceTranscode: true, keyFrameInterval: 1, quality: new Quality('high'),
        ...(dimensions ?? (maxHeight > 0 && await video.getDisplayHeight() > maxHeight ? { height: maxHeight } : {})) },
      audio: { codec: 'aac' },
    });
    signal.throwIfAborted();
    if (!conversion.isValid || conversion.discardedTracks.some(track => track.reason !== 'discarded_by_user')) {
      throw new Error('This browser cannot prepare all video and audio tracks. Try Chrome or Edge with a supported video file.');
    }
    conversion.onProgress = reportProgress;
    await conversion.execute();
    signal.throwIfAborted();
    if (!output.target.buffer) throw new Error('The frame-rate conversion produced no video.');
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  } finally {
    signal.removeEventListener('abort', abort);
    if (conversion && conversion.state !== 'done') await conversion.cancel().catch(() => undefined);
    input.dispose();
  }
}
