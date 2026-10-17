import { AudioSample, AudioSampleSink, type Input } from 'mediabunny';
import { AudioNormalizer, COMPOSITION_AUDIO_CHANNELS as CHANNELS, COMPOSITION_AUDIO_RATE as RATE } from './AudioNormalizer';
import { segmentTime, type CompositionTransition } from './CompositionTransitions';
import type { TimelineSegment } from './TimelineComposition';

/** Decodes only the small overlap windows, normalizing both inputs before mixing. */
export class CompositionAudioCrossfade {
  private cache = new Map<CompositionTransition, Promise<Float32Array[]>>();
  constructor(private transitions: CompositionTransition[], private fps: number,
    private inputFor: (segment: TimelineSegment) => Input, private signal: AbortSignal) {}

  private async samples(segment: TimelineSegment, transition: CompositionTransition) {
    const length = Math.round((transition.endFrame - transition.startFrame) / this.fps * RATE);
    const planes = Array.from({ length: CHANNELS }, () => new Float32Array(length));
    if (segment.still) return planes;
    const track = await this.inputFor(segment).getPrimaryAudioTrack();
    if (!track) return planes;
    if (!await track.canDecode()) throw new Error(`Unable to decode audio in ${segment.label}.`);
    const start = segmentTime(segment, transition.startFrame, this.fps), end = segmentTime(segment, transition.endFrame, this.fps);
    if (end <= 0) return planes;
    const normalize = new AudioNormalizer(async sample => {
      this.signal.throwIfAborted();
      const offset = Math.round((sample.timestamp - start) * RATE);
      const first = Math.max(0, -offset), last = Math.min(sample.numberOfFrames, length - offset);
      if (last <= first) return;
      for (let channel = 0; channel < CHANNELS; channel++) {
        const data = new Float32Array(sample.numberOfFrames);
        sample.copyTo(data, { planeIndex: channel, format: 'f32-planar' });
        planes[channel].set(data.subarray(first, last), offset + first);
      }
    });
    const cancel = () => { void normalize.cancel().catch(() => undefined); };
    this.signal.addEventListener('abort', cancel, { once: true });
    try {
      this.signal.throwIfAborted();
      for await (const raw of new AudioSampleSink(track).samples(Math.max(0, start), end)) {
        try {
          this.signal.throwIfAborted();
          const first = Math.max(0, Math.round((Math.max(0, start) - raw.timestamp) * raw.sampleRate));
          const last = Math.min(raw.numberOfFrames, Math.round((end - raw.timestamp) * raw.sampleRate));
          if (last <= first) continue;
          const sample = raw.trim(first, last);
          try { await normalize.add(sample); } finally { sample.close(); }
        } finally { raw.close(); }
      }
      await normalize.flush();
      return planes;
    } finally { this.signal.removeEventListener('abort', cancel); await normalize.cancel(); }
  }

  private async mixed(transition: CompositionTransition) {
    const [before, after] = await Promise.all([this.samples(transition.before, transition), this.samples(transition.after, transition)]);
    this.signal.throwIfAborted();
    for (let channel = 0; channel < CHANNELS; channel++) {
      for (let frame = 0; frame < before[channel].length; frame++) {
        const weight = (frame + .5) / before[channel].length;
        before[channel][frame] = before[channel][frame] * (1 - weight) + after[channel][frame] * weight;
      }
    }
    return before;
  }

  async write(sample: AudioSample, origin: number, write: (sample: AudioSample) => Promise<void>) {
    const start = Math.round((origin + sample.timestamp) * RATE), end = start + sample.numberOfFrames;
    for (const transition of this.cache.keys()) if (transition.endFrame / this.fps * RATE <= start) this.cache.delete(transition);
    const overlaps = this.transitions.filter(transition => transition.startFrame / this.fps * RATE < end && transition.endFrame / this.fps * RATE > start);
    if (!overlaps.length) { await write(sample); return; }
    const data = new Float32Array(sample.numberOfFrames * CHANNELS);
    for (let channel = 0; channel < CHANNELS; channel++) sample.copyTo(data.subarray(channel * sample.numberOfFrames, (channel + 1) * sample.numberOfFrames), { planeIndex: channel, format: 'f32-planar' });
    for (const transition of overlaps) {
      let mixed = this.cache.get(transition);
      if (!mixed) { mixed = this.mixed(transition); this.cache.set(transition, mixed); }
      const planes = await mixed;
      const offset = Math.round(transition.startFrame / this.fps * RATE) - start;
      const first = Math.max(0, -offset), last = Math.min(planes[0].length, sample.numberOfFrames - offset);
      for (let channel = 0; channel < CHANNELS; channel++) data.set(planes[channel].subarray(first, last), channel * sample.numberOfFrames + offset + first);
    }
    const blended = new AudioSample({ data, format: 'f32-planar', sampleRate: RATE, numberOfChannels: CHANNELS, timestamp: sample.timestamp });
    try { this.signal.throwIfAborted(); await write(blended); } finally { blended.close(); }
  }
}
