import type { FrameDecoder } from './FrameDecoder';

type Voice = { gain: GainNode; sources: Set<AudioBufferSourceNode>; scheduled: number; media: number; clock: number; speed: number };

/** Decoded audio is scheduled on the same AudioContext clock used by the playhead. */
export class CanvasAudio {
  readonly context = new AudioContext();
  private voices = new Map<string, Voice>();
  private lastClock = this.context.currentTime;
  private disposed = false;
  private resuming?: Promise<void>;
  error?: Error;
  elapsed() { const now = this.context.currentTime, elapsed = now - this.lastClock; this.lastClock = now; return elapsed; }
  resume() {
    if (this.context.state === 'suspended' && !this.resuming) this.resuming = this.context.resume()
      .catch(error => { if (!this.disposed) this.error = error; }).finally(() => { this.resuming = undefined; });
  }
  render(key: string, decoder: FrameDecoder, time: number, gain: number, gainRate: number, volume: number, speed: number) {
    const now = this.context.currentTime;
    let voice = this.voices.get(key);
    if (voice && (voice.speed !== speed || Math.abs(voice.media + (now - voice.clock) * speed - time) > .08)) { this.stop(key); voice = undefined; }
    if (!voice) {
      const gain = this.context.createGain(); gain.connect(this.context.destination);
      voice = { gain, sources: new Set(), scheduled: time, media: time, clock: now, speed }; this.voices.set(key, voice);
    }
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(volume * gain, now);
    voice.gain.gain.linearRampToValueAtTime(volume * Math.max(0, Math.min(1, gain + gainRate * speed * .04)), now + .04);
    for (const sample of decoder.audio) {
      const end = sample.timestamp + sample.duration;
      const from = Math.max(sample.timestamp, voice.scheduled, time);
      if (end <= from + 1e-7 || from > time + .25 * speed) continue;
      const source = this.context.createBufferSource(); source.buffer = sample.buffer; source.playbackRate.value = speed;
      source.connect(voice.gain); voice.sources.add(source);
      const owner = voice;
      source.onended = () => { source.disconnect(); owner.sources.delete(source); };
      source.start(Math.max(now, voice.clock + (from - voice.media) / speed), from - sample.timestamp, end - from);
      voice.scheduled = end;
    }
  }
  retain(keys: Set<string>) { for (const key of this.voices.keys()) if (!keys.has(key)) this.stop(key); }
  private stop(key: string) {
    const voice = this.voices.get(key); if (!voice) return;
    voice.sources.forEach(source => { source.stop(); source.disconnect(); }); voice.gain.disconnect(); this.voices.delete(key);
  }
  pause() { this.retain(new Set()); this.lastClock = this.context.currentTime; }
  dispose() { this.disposed = true; this.pause(); void this.context.close(); }
}
