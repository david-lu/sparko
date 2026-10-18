import type { FrameDecoder } from './FrameDecoder';

type Voice = { gain: GainNode; sources: Set<AudioBufferSourceNode>; scheduled: number; media: number; clock: number; speed: number };
type LoopMusic = { url: string; buffer?: AudioBuffer; source?: AudioBufferSourceNode; gain?: GainNode;
  offset: number; clock: number; speed: number; controller: AbortController };

/** Decoded audio is scheduled on the same AudioContext clock used by the playhead. */
export class CanvasAudio {
  readonly context = new AudioContext();
  private voices = new Map<string, Voice>();
  private lastClock = this.context.currentTime;
  private disposed = false;
  private resuming?: Promise<void>;
  private music?: LoopMusic;
  error?: Error;
  elapsed() { const now = this.context.currentTime, elapsed = now - this.lastClock; this.lastClock = now; return elapsed; }
  resume() {
    if (this.context.state === 'suspended' && !this.resuming) this.resuming = this.context.resume()
      .catch(error => { if (!this.disposed) this.error = error; }).finally(() => { this.resuming = undefined; });
  }
  async prepareMusic(url: string) {
    if (this.music?.url === url) return;
    this.stopMusic(false);
    this.music?.controller.abort();
    const music: LoopMusic = { url, offset: 0, clock: 0, speed: 1, controller: new AbortController() };
    this.music = music;
    try {
      const response = await fetch(url, { signal: music.controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      if (!this.disposed && this.music === music) music.buffer = buffer;
    } catch (error) {
      if (!music.controller.signal.aborted && !this.disposed) console.error('Unable to load Idle music.', error);
    }
  }
  private stopMusic(preserve: boolean) {
    const music = this.music;
    if (!music) return;
    if (music.source) {
      const now = this.context.currentTime;
      if (preserve && music.buffer) music.offset = (music.offset + (now - music.clock) * music.speed) % music.buffer.duration;
      const source = music.source, gain = music.gain;
      gain?.gain.cancelScheduledValues(now);
      gain?.gain.setTargetAtTime(0, now, .01);
      source.onended = () => { source.disconnect(); gain?.disconnect(); };
      source.stop(now + .05);
      music.source = undefined; music.gain = undefined;
    }
    if (!preserve) music.offset = 0;
  }
  renderMusic(active: boolean, playing: boolean, volume: number, speed: number) {
    const music = this.music;
    if (!music || !active) { this.stopMusic(false); return; }
    if (!playing || !music.buffer) { this.stopMusic(true); return; }
    const now = this.context.currentTime;
    if (!music.source) {
      music.gain = this.context.createGain(); music.gain.gain.setValueAtTime(0, now);
      music.gain.connect(this.context.destination);
      music.source = this.context.createBufferSource(); music.source.buffer = music.buffer;
      music.source.loop = true; music.source.playbackRate.value = speed; music.source.connect(music.gain);
      music.clock = now; music.speed = speed; music.source.start(now, music.offset);
    } else if (music.speed !== speed) {
      music.offset = (music.offset + (now - music.clock) * music.speed) % music.buffer.duration;
      music.clock = now; music.speed = speed; music.source.playbackRate.setValueAtTime(speed, now);
    }
    music.gain!.gain.setTargetAtTime(volume, now, .035);
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
  pause() { this.retain(new Set()); this.stopMusic(true); this.lastClock = this.context.currentTime; }
  dispose() { this.disposed = true; this.pause(); this.music?.controller.abort(); this.music = undefined; void this.context.close(); }
}
