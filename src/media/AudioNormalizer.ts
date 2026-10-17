import { AudioSample, AudioSampleSource, NullTarget, Output, WavOutputFormat } from 'mediabunny';

export const COMPOSITION_AUDIO_RATE = 48000;
export const COMPOSITION_AUDIO_CHANNELS = 2;

/** Normalize each run of matching input formats before feeding the shared timeline encoder. */
export class AudioNormalizer {
  private stage: { rate: number; channels: number; source: AudioSampleSource; output: Output } | null = null;
  constructor(private write: (sample: AudioSample) => Promise<void>) {}

  async add(sample: AudioSample) {
    if (this.stage && (this.stage.rate !== sample.sampleRate || this.stage.channels !== sample.numberOfChannels)) await this.flush();
    if (sample.sampleRate === COMPOSITION_AUDIO_RATE && sample.numberOfChannels === COMPOSITION_AUDIO_CHANNELS) {
      await this.write(sample); return;
    }
    if (!this.stage) {
      // AudioSampleSource checks its INPUT format before resampling, so each format needs its own source.
      // Its public process hook yields continuous resampled PCM; NullTarget avoids another encoded media copy.
      const output = new Output({ target: new NullTarget(), format: new WavOutputFormat() });
      const source = new AudioSampleSource({ codec: 'pcm-f32', transform: {
        sampleRate: COMPOSITION_AUDIO_RATE, numberOfChannels: COMPOSITION_AUDIO_CHANNELS,
        process: async normalized => { await this.write(normalized); return null; },
      } });
      output.addAudioTrack(source, { decoderConfig: {
        codec: 'pcm-f32', sampleRate: COMPOSITION_AUDIO_RATE, numberOfChannels: COMPOSITION_AUDIO_CHANNELS,
      } });
      this.stage = { rate: sample.sampleRate, channels: sample.numberOfChannels, source, output };
      await output.start();
    }
    await this.stage.source.add(sample);
  }

  async flush() {
    const stage = this.stage;
    if (!stage) return;
    // Flush the resampler's tail before the next format (including synthesized silence) is written.
    await stage.output.finalize();
    if (this.stage === stage) this.stage = null;
  }

  async cancel() {
    const stage = this.stage; this.stage = null;
    await stage?.output.cancel();
  }
}
