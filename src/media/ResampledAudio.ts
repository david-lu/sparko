import type { WrappedAudioBuffer } from 'mediabunny';

const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;

/** A bounded run of contiguous PCM, resampled on one consistent output sample grid. */
class AudioRun {
  private chunks: { buffer: AudioBuffer; start: number }[] = [];
  private received = 0;
  private position = 0;
  private block: number;
  private padding: number;
  readonly rate: number;
  readonly channels: number;
  readonly origin: number;
  constructor(first: WrappedAudioBuffer, private targetRate: number) {
    this.rate = first.buffer.sampleRate; this.channels = first.buffer.numberOfChannels; this.origin = first.timestamp;
    // Starting every render on both input and output sample boundaries preserves the filter's phase.
    const quantum = this.rate / gcd(this.rate, targetRate);
    this.block = Math.ceil(this.rate * .25 / quantum) * quantum;
    this.padding = Math.ceil(256 * Math.max(1, this.rate / targetRate) / quantum) * quantum;
  }
  accepts(sample: WrappedAudioBuffer) {
    return sample.buffer.sampleRate === this.rate && sample.buffer.numberOfChannels === this.channels
      // Container timestamps may be rounded to microseconds. Count PCM frames to avoid cumulative drift.
      && Math.abs(sample.timestamp - (this.origin + this.received / this.rate)) <= Math.max(1e-6, .5 / this.rate);
  }
  add(sample: WrappedAudioBuffer) { this.chunks.push({ buffer: sample.buffer, start: this.received }); this.received += sample.buffer.length; }
  async take(final: boolean): Promise<WrappedAudioBuffer | undefined> {
    if (this.position >= this.received || !final && this.received < this.position + this.block + this.padding) return;
    const end = Math.min(this.position + this.block, this.received);
    const first = Math.max(0, this.position - this.padding), last = Math.min(this.received, end + this.padding);
    const input = new AudioBuffer({ numberOfChannels: this.channels, length: last - first, sampleRate: this.rate });
    for (const chunk of this.chunks) {
      const from = Math.max(first, chunk.start), to = Math.min(last, chunk.start + chunk.buffer.length);
      if (to <= from) continue;
      for (let channel = 0; channel < this.channels; channel++) {
        input.copyToChannel(chunk.buffer.getChannelData(channel).subarray(from - chunk.start, to - chunk.start), channel, from - first);
      }
    }
    const ratio = this.targetRate / this.rate;
    const context = new OfflineAudioContext(this.channels, Math.ceil(input.length * ratio), this.targetRate);
    const source = context.createBufferSource(); source.buffer = input; source.connect(context.destination); source.start();
    const rendered = await context.startRendering();
    source.disconnect();
    const offset = Math.round((this.position - first) * ratio), startFrame = Math.round(this.position * ratio);
    const length = Math.round(end * ratio) - startFrame;
    this.position = end;
    while (this.chunks.length && this.chunks[0].start + this.chunks[0].buffer.length <= this.position - this.padding) this.chunks.shift();
    if (!length) return;
    const buffer = new AudioBuffer({ numberOfChannels: this.channels, length, sampleRate: this.targetRate });
    for (let channel = 0; channel < this.channels; channel++) buffer.copyToChannel(rendered.getChannelData(channel).subarray(offset, offset + length), channel);
    return { buffer, timestamp: this.origin + startFrame / this.targetRate, duration: buffer.duration };
  }
}

/**
 * Resample decoded audio before scheduling it. Overlapping filter history and lookahead are discarded
 * after rendering, so adjacent output blocks have no independent resampler startup/tail artifacts.
 * Matching rates pass through; gaps and format changes start a new run without joining unrelated audio.
 */
export async function* resampledAudio(samples: AsyncIterable<WrappedAudioBuffer>, targetRate: number): AsyncGenerator<WrappedAudioBuffer, void, unknown> {
  let run: AudioRun | undefined;
  for await (const sample of samples) {
    if (run && !run.accepts(sample)) {
      for (let result; (result = await run.take(true));) yield result;
      run = undefined;
    }
    if (sample.buffer.sampleRate === targetRate) { yield sample; continue; }
    run ??= new AudioRun(sample, targetRate);
    run.add(sample);
    for (let result; (result = await run.take(false));) yield result;
  }
  if (run) for (let result; (result = await run.take(true));) yield result;
}
