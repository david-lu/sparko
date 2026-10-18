import { AudioBufferSink, VideoSampleSink, type Input, type VideoSample, type WrappedAudioBuffer } from 'mediabunny';
import { openInput, type MediaSource } from '../../media/media';
import { resampledAudio } from '../../media/ResampledAudio';

/** Sequential, bounded decode queues. Seeking discards the old iterator and its frames. */
export class FrameDecoder {
  private input: Input;
  private videoSink?: VideoSampleSink;
  private audioSink?: AudioBufferSink;
  private videoIterator?: AsyncGenerator<VideoSample, void, unknown>;
  private audioIterator?: AsyncGenerator<WrappedAudioBuffer, void, unknown>;
  private frames: VideoSample[] = [];
  audio: WrappedAudioBuffer[] = [];
  private generation = 0;
  private videoPump = false;
  private audioPump = false;
  private videoEnded = false;
  private audioEnded = false;
  private disposed = false;
  private initialized = false;
  private requested = 0;
  private start = 0;
  private limit = 8;
  private first = 0;
  duration = 0;
  hasAudio = false;
  error?: Error;
  constructor(source: MediaSource, time: number, private audioSampleRate: number) {
    this.input = openInput(source); this.requested = time;
    void this.open().catch(error => { if (!this.disposed) this.error = error; });
  }
  private async open() {
    const [video, audio] = await Promise.all([this.input.getPrimaryVideoTrack(), this.input.getPrimaryAudioTrack()]);
    if (!video || !await video.canDecode()) throw new Error('This browser cannot decode this video.');
    if (audio && !await audio.canDecode()) throw new Error('This browser cannot decode this audio.');
    const [first, duration, width, height] = await Promise.all([video.getFirstTimestamp(), video.computeDuration(), video.getDisplayWidth(), video.getDisplayHeight()]);
    if (this.disposed) return;
    this.first = first; this.duration = duration;
    this.limit = Math.max(2, Math.min(12, Math.floor(32 * 1024 * 1024 / (width * height * 4))));
    this.videoSink = new VideoSampleSink(video);
    this.audioSink = audio ? new AudioBufferSink(audio) : undefined; this.hasAudio = !!audio;
    this.initialized = true; this.reset(this.requested);
  }
  private reset(time: number) {
    this.generation++; this.start = this.clamp(time);
    void this.videoIterator?.return().catch(() => undefined); void this.audioIterator?.return().catch(() => undefined);
    this.frames.forEach(frame => frame.close()); this.frames = []; this.audio = [];
    this.videoEnded = false; this.audioEnded = !this.audioSink; this.videoPump = false; this.audioPump = false;
    this.videoIterator = this.videoSink!.samples(this.start);
    // A little preroll warms the codec and resampling filter when seeking into a clip.
    this.audioIterator = this.audioSink ? resampledAudio(this.audioSink.buffers(Math.max(0, time - .1)), this.audioSampleRate) : undefined;
    this.fillVideo(); this.fillAudio();
  }
  private clamp(time: number) { return Math.max(this.first, Math.min(this.duration - 1e-6, time)); }
  private fillVideo() {
    if (this.videoPump || this.videoEnded || this.disposed || !this.videoIterator) return;
    this.videoPump = true;
    const generation = this.generation, iterator = this.videoIterator;
    void (async () => {
      try {
        while (!this.disposed && generation === this.generation && this.frames.length < this.limit) {
          const { value, done } = await iterator.next();
          if (generation !== this.generation || this.disposed) { value?.close(); return; }
          if (done) { this.videoEnded = true; break; }
          this.frames.push(value);
        }
      } catch (error) { if (generation === this.generation && !this.disposed) this.error = error as Error; }
      finally { if (generation === this.generation) this.videoPump = false; }
    })();
  }
  private fillAudio() {
    if (this.audioPump || this.audioEnded || this.disposed || !this.audioIterator) return;
    this.audioPump = true;
    const generation = this.generation, iterator = this.audioIterator;
    void (async () => {
      try {
        while (!this.disposed && generation === this.generation && (!this.audio.length || this.audio.at(-1)!.timestamp < this.requested + .5)) {
          const { value, done } = await iterator.next();
          if (generation !== this.generation || this.disposed) return;
          if (done) { this.audioEnded = true; break; }
          this.audio.push(value);
        }
      } catch (error) { if (generation === this.generation && !this.disposed) this.error = error as Error; }
      finally { if (generation === this.generation) this.audioPump = false; }
    })();
  }
  at(time: number) {
    if (this.error) throw this.error;
    this.requested = time;
    if (!this.initialized) return;
    const target = this.clamp(time), last = this.frames.at(-1);
    if (target < (this.frames[0]?.timestamp ?? this.start) - 1e-5 || target > (last ? last.timestamp + last.duration : this.start) + .5) this.reset(time);
    while (this.frames.length > 1 && this.frames[1].timestamp <= target + 1e-7) this.frames.shift()!.close();
    while (this.audio.length && this.audio[0].timestamp + this.audio[0].duration < time - .05) this.audio.shift();
    this.fillVideo(); this.fillAudio();
    const frame = this.frames[0];
    return frame && (target < frame.timestamp + frame.duration + 1e-7 || this.videoEnded) ? frame : undefined;
  }
  audioReady(time: number) {
    return !this.hasAudio || time < 0 || time >= this.duration || this.audioEnded
      || this.audio.some(sample => sample.timestamp + sample.duration > time);
  }
  get bufferedEnd() { const last = this.frames.at(-1); return last ? last.timestamp + last.duration : this.start; }
  dispose() {
    this.disposed = true; this.generation++;
    this.frames.forEach(frame => frame.close()); this.frames = []; this.audio = [];
    void this.videoIterator?.return().catch(() => undefined); void this.audioIterator?.return().catch(() => undefined);
    this.input.dispose();
  }
}
