import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, UrlSource } from 'mediabunny';
import { TIMELINE_FPS } from '../../../shared/constants';
import { assets } from '../project/assets';

export type WaveformSource = { assetId?: string; url?: string; sourceFrame: number; frames: number };
export type WaveformData = { peaks: number[]; hasAudio: boolean };
const cache = new Map<string, WaveformData>();
export const waveformKey = (source: WaveformSource) => `${source.assetId ?? source.url}:${source.sourceFrame}:${source.frames}`;

/** Decode only the visible source interval, keeping four peaks per timeline frame. */
export async function audioWaveform(source: WaveformSource, signal: AbortSignal): Promise<WaveformData> {
  const key = waveformKey(source), cached = cache.get(key);
  if (cached) return cached;
  const media = source.assetId ? new BlobSource((await assets.open(source.assetId)).asset.blob) : new UrlSource(source.url!);
  signal.throwIfAborted();
  const input = new Input({ formats: ALL_FORMATS, source: media });
  const abort = () => input.dispose(); signal.addEventListener('abort', abort, { once: true });
  try {
    const track = await input.getPrimaryAudioTrack();
    const peaks = new Array<number>(Math.max(1, source.frames * 4)).fill(0);
    if (track) {
      if (!await track.canDecode()) throw new Error('Audio cannot be decoded');
      const start = source.sourceFrame / TIMELINE_FPS, end = start + source.frames / TIMELINE_FPS;
      for await (const sample of new AudioSampleSink(track).samples(start, end)) {
        try {
          signal.throwIfAborted();
          const data = new Float32Array(sample.numberOfFrames);
          for (let channel = 0; channel < sample.numberOfChannels; channel++) {
            sample.copyTo(data, { planeIndex: channel, format: 'f32-planar' });
            for (let i = 0; i < data.length; i++) {
              const bin = Math.floor((sample.timestamp + i / sample.sampleRate - start) * TIMELINE_FPS * 4);
              if (bin >= 0 && bin < peaks.length) peaks[bin] = Math.max(peaks[bin], Math.abs(data[i]));
            }
          }
        } finally { sample.close(); }
      }
    }
    signal.throwIfAborted();
    const result = { peaks, hasAudio: !!track }; cache.set(key, result);
    if (cache.size > 48) cache.delete(cache.keys().next().value!);
    return result;
  } finally { signal.removeEventListener('abort', abort); input.dispose(); }
}
