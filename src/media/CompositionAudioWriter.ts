import { AudioSample } from 'mediabunny';
import { COMPOSITION_AUDIO_CHANNELS as CHANNELS, COMPOSITION_AUDIO_RATE as RATE } from './AudioNormalizer';

const BLOCK = 1024;
/** Feed native AAC whole codec blocks, including when a seek begins inside a dissolve. */
export class CompositionAudioWriter {
  private data = new Float32Array(BLOCK * CHANNELS);
  private pending = 0;
  private written = 0;
  constructor(private write: (sample: AudioSample) => Promise<void>) {}

  private async emit() {
    if (!this.pending) return;
    const data = new Float32Array(this.pending * CHANNELS);
    for (let channel = 0; channel < CHANNELS; channel++) data.set(this.data.subarray(channel * BLOCK, channel * BLOCK + this.pending), channel * this.pending);
    const sample = new AudioSample({ data, format: 'f32-planar', sampleRate: RATE, numberOfChannels: CHANNELS, timestamp: this.written / RATE });
    try { await this.write(sample); } finally { sample.close(); }
    this.written += this.pending; this.pending = 0;
  }

  private async append(sample: AudioSample | null, first: number, count: number) {
    let offset = 0;
    while (offset < count) {
      const frames = Math.min(BLOCK - this.pending, count - offset);
      for (let channel = 0; channel < CHANNELS; channel++) {
        const target = this.data.subarray(channel * BLOCK + this.pending, channel * BLOCK + this.pending + frames);
        if (sample) sample.copyTo(target, { planeIndex: channel, format: 'f32-planar', frameOffset: first + offset, frameCount: frames });
        else target.fill(0);
      }
      this.pending += frames; offset += frames;
      if (this.pending === BLOCK) await this.emit();
    }
  }

  async add(sample: AudioSample) {
    const position = Math.round(sample.timestamp * RATE), cursor = this.written + this.pending;
    if (position > cursor) await this.append(null, 0, position - cursor);
    const first = Math.max(0, cursor - position);
    if (first < sample.numberOfFrames) await this.append(sample, first, sample.numberOfFrames - first);
  }
  async flush() { await this.emit(); }
}
