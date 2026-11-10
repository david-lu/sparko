import { AudioBufferSink, AudioSample, type Input, type WrappedAudioBuffer } from 'mediabunny';
import { TIMELINE_FPS as FPS } from '../../shared/constants';
import { assets } from '../features/project/assets';
import { openInput } from './media';
import { resampledAudio } from './ResampledAudio';
import { COMPOSITION_AUDIO_CHANNELS as CHANNELS, COMPOSITION_AUDIO_RATE as RATE } from './AudioNormalizer';

/** A sound placed on a composition's frame clock and mixed over its footage audio. */
export type AudioLayer = { id: string; assetId: string; name: string; startFrame: number; inFrame: number; outFrame: number; volume: number; muted: boolean };
export const audioLayerEnd = (layer: AudioLayer) => layer.startFrame + layer.outFrame - layer.inFrame;

type Decoder = { input: Input; samples: AsyncGenerator<WrappedAudioBuffer, void, unknown>; current?: WrappedAudioBuffer; ended?: boolean };

/** Mix bounded decoded chunks after clip crossfades, on the export's sample clock. */
export class CompositionAudioLayers {
  private decoders = new Map<string, Decoder>();
  constructor(private layers: AudioLayer[], private signal: AbortSignal) {}

  private async decoder(layer: AudioLayer, sourceStart: number): Promise<Decoder> {
    const existing = this.decoders.get(layer.id); if (existing) return existing;
    const url = assets.url(layer.assetId);
    if (!url) throw new Error(`Audio layer “${layer.name}” is unavailable.`);
    const input = openInput({ id: layer.assetId, assetId: layer.assetId, url, name: layer.name, kind: 'audio' });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track || !await track.canDecode()) throw new Error(`Unable to decode audio layer “${layer.name}”.`);
      this.signal.throwIfAborted();
      const decoder = { input, samples: resampledAudio(new AudioBufferSink(track).buffers(Math.max(0, sourceStart - .1), layer.outFrame / FPS), RATE) };
      this.decoders.set(layer.id, decoder); return decoder;
    } catch (error) { input.dispose(); throw error; }
  }

  async write(sample: AudioSample, origin: number, write: (sample: AudioSample) => Promise<void>) {
    this.signal.throwIfAborted();
    const start = Math.round((sample.timestamp + origin) * RATE), end = start + sample.numberOfFrames;
    const overlaps = this.layers.filter(layer => !layer.muted && layer.volume > 0 && layer.startFrame / FPS * RATE < end && audioLayerEnd(layer) / FPS * RATE > start);
    if (!overlaps.length) { await write(sample); return; }
    const data = new Float32Array(sample.numberOfFrames * CHANNELS);
    for (let channel = 0; channel < CHANNELS; channel++) sample.copyTo(data.subarray(channel * sample.numberOfFrames, (channel + 1) * sample.numberOfFrames), { planeIndex: channel, format: 'f32-planar' });
    for (const layer of overlaps) {
      const from = Math.max(start, Math.round(layer.startFrame / FPS * RATE)), to = Math.min(end, Math.round(audioLayerEnd(layer) / FPS * RATE));
      const shift = Math.round((layer.startFrame - layer.inFrame) / FPS * RATE);
      const decoder = await this.decoder(layer, (from - shift) / RATE);
      while (!decoder.ended) {
        this.signal.throwIfAborted();
        if (!decoder.current) { const next = await decoder.samples.next(); decoder.current = next.done ? undefined : next.value; decoder.ended = next.done; }
        const current = decoder.current; if (!current) break;
        const position = Math.round(current.timestamp * RATE) + shift, limit = position + current.buffer.length;
        if (position >= to) break;
        const first = Math.max(from, position), last = Math.min(to, limit);
        for (let channel = 0; channel < CHANNELS; channel++) {
          const source = current.buffer.getChannelData(Math.min(channel, current.buffer.numberOfChannels - 1));
          for (let frame = first; frame < last; frame++) data[channel * sample.numberOfFrames + frame - start] += source[frame - position] * layer.volume;
        }
        if (limit >= to) break;
        decoder.current = undefined;
      }
    }
    const mixed = new AudioSample({ data, format: 'f32-planar', sampleRate: RATE, numberOfChannels: CHANNELS, timestamp: sample.timestamp });
    try { this.signal.throwIfAborted(); await write(mixed); } finally { mixed.close(); }
  }

  dispose() {
    for (const decoder of this.decoders.values()) { void decoder.samples.return().catch(() => undefined); decoder.input.dispose(); }
    this.decoders.clear();
  }
}
