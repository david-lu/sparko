import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, EncodedPacketSink, Input, Mp4InputFormat, Mp4OutputFormat, Output, type InputVideoTrack } from 'mediabunny';
import { TIMELINE_FPS, VIDEO_PREPARATION } from '../../shared/constants';
import { ensureAac } from './media';

/** Check the entire presentation clock, not just an average that can hide variable frame rates. */
async function hasProjectClock(track: InputVideoTrack, signal: AbortSignal) {
  const frames = new Set<number>();
  for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
    signal.throwIfAborted();
    const frame = Math.round(packet.timestamp * TIMELINE_FPS);
    if (frame < 0 || Math.abs(packet.timestamp - frame / TIMELINE_FPS) > 1e-6
      || Math.abs(packet.duration - 1 / TIMELINE_FPS) > 1e-6 || frames.has(frame)) return false;
    frames.add(frame);
  }
  return frames.size > 0 && frames.has(0) && [...frames].every(frame => frame < frames.size);
}

/** Probe Mediabunny decoding without starting an encoder. */
export async function canPlaySourceVideo(blob: Blob, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('This file has no video track.');
    const audio = await input.getPrimaryAudioTrack();
    const playable = await video.canDecode() && (!audio || await audio.canDecode());
    signal.throwIfAborted(); return playable;
  } finally { input.dispose(); }
}

/** Keep decodable source media intact, with conversion only as a compatibility fallback. */
export async function prepareSourceVideo(blob: Blob, signal: AbortSignal, onProgress: (progress: number) => void): Promise<Blob> {
  return await canPlaySourceVideo(blob, signal) ? blob : prepareVideo(blob, signal, onProgress, false);
}

/** Prepare a durable 24 fps working file. Compatible files are returned unchanged. */
export async function prepareVideo(blob: Blob, signal: AbortSignal, onProgress: (progress: number) => void, reuseCompatible = true): Promise<Blob> {
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
    if (reuseCompatible && await input.getFormat() instanceof Mp4InputFormat && await video.getCodec() === 'avc'
      && (!audio || await audio.getCodec() === 'aac') && await hasProjectClock(video, signal)) return blob;
    signal.throwIfAborted();
    reportProgress(0);
    await ensureAac();
    signal.throwIfAborted();
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    conversion = await Conversion.init({ input, output, tracks: 'primary', trim: { start: 0 },
      video: { codec: 'avc', frameRate: TIMELINE_FPS, forceTranscode: true, keyFrameInterval: 1,
        ...(VIDEO_PREPARATION.maxHeight > 0 && await video.getDisplayHeight() > VIDEO_PREPARATION.maxHeight ? { height: VIDEO_PREPARATION.maxHeight } : {}) },
      audio: { codec: 'aac' },
    });
    signal.throwIfAborted();
    if (!conversion.isValid || conversion.discardedTracks.some(track => track.reason !== 'discarded_by_user')) {
      throw new Error('This browser cannot prepare all video and audio tracks. Try Chrome or Edge with a supported video file.');
    }
    conversion.onProgress = reportProgress;
    await conversion.execute();
    signal.throwIfAborted();
    if (!output.target.buffer) throw new Error('The 24 fps conversion produced no video.');
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  } finally {
    signal.removeEventListener('abort', abort);
    if (conversion && conversion.state !== 'done') await conversion.cancel().catch(() => undefined);
    input.dispose();
  }
}
