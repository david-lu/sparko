import type { MediaSource } from '../../media/media';

export type PlayerState = {
  time: number; duration: number; playing: boolean; buffering: boolean;
  volume: number; muted: boolean; speed: number; loop: boolean; error: string | null;
  buffered: { start: number; end: number }[];
};
const initialState = (): PlayerState => ({ time: 0, duration: 0, playing: false, buffering: false,
  volume: 1, muted: false, speed: 1, loop: false, error: null, buffered: [] });

/** Owns transport, media events, segment playback, and element lifetime. No React dependency. */
export class VideoPlayerController {
  private element: HTMLVideoElement | null = null;
  private source: MediaSource | null = null;
  private state = initialState();
  private listeners = new Set<() => void>();
  private removeEvents: (() => void) | null = null;
  private previewEnd: number | null = null;

  getSnapshot = (): PlayerState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  get video(): HTMLVideoElement | null { return this.element; }
  private update(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }

  attach = (element: HTMLVideoElement | null) => {
    if (element === this.element) return;
    this.removeEvents?.();
    this.element?.pause();
    this.element = element;
    if (!element) return;
    const sync = () => {
      if (this.previewEnd !== null && element.currentTime >= this.previewEnd) {
        const end = this.previewEnd; this.previewEnd = null; element.pause(); element.currentTime = end;
      }
      this.update({ time: element.currentTime, duration: Number.isFinite(element.duration) ? element.duration : 0,
        playing: !element.paused && !element.ended, volume: element.volume, muted: element.muted,
        speed: element.playbackRate, loop: element.loop,
        buffered: Array.from({ length: element.buffered.length }, (_, i) => ({ start: element.buffered.start(i), end: element.buffered.end(i) })),
      });
    };
    const waiting = () => this.update({ buffering: true });
    const ready = () => this.update({ buffering: false });
    const error = () => this.update({ buffering: false, error: 'Unable to play this video. Check the file and browser codec support.' });
    const syncEvents = ['timeupdate', 'loadedmetadata', 'durationchange', 'play', 'pause', 'ended', 'volumechange', 'ratechange', 'progress'];
    syncEvents.forEach(event => element.addEventListener(event, sync));
    element.addEventListener('waiting', waiting);
    ['playing', 'canplay', 'seeked'].forEach(event => element.addEventListener(event, ready));
    element.addEventListener('error', error);
    this.removeEvents = () => {
      syncEvents.forEach(event => element.removeEventListener(event, sync));
      element.removeEventListener('waiting', waiting);
      ['playing', 'canplay', 'seeked'].forEach(event => element.removeEventListener(event, ready));
      element.removeEventListener('error', error);
    };
    this.applySettings();
    if (this.source) { element.src = this.source.url; element.load(); }
  };

  load(source: MediaSource) {
    this.source = source; this.previewEnd = null;
    this.element?.pause();
    this.update({ time: 0, duration: 0, playing: false, buffering: false, error: null, buffered: [] });
    if (this.element) { this.element.src = source.url; this.applySettings(); this.element.load(); }
  }
  private applySettings() {
    if (!this.element) return;
    this.element.volume = this.state.volume; this.element.muted = this.state.muted;
    this.element.playbackRate = this.state.speed; this.element.loop = this.state.loop;
  }
  async play() {
    if (!this.element) return;
    try { await this.element.play(); }
    catch { this.update({ error: 'Playback could not start. Try a browser-supported video file.' }); }
  }
  pause() { this.element?.pause(); }
  togglePlayback() { if (this.element?.paused) void this.play(); else this.pause(); }
  seek(time: number) {
    if (!this.element || !Number.isFinite(time) || !this.state.duration) return;
    this.previewEnd = null;
    this.element.currentTime = Math.max(0, Math.min(this.state.duration, time));
    this.update({ time: this.element.currentTime });
  }
  skip(seconds: number) { this.seek((this.element?.currentTime || 0) + seconds); }
  stepFrame(direction: -1 | 1, fps: number) { this.pause(); this.skip(direction / (fps || 30)); }
  setVolume(volume: number) {
    if (!this.element) return;
    this.element.volume = Math.max(0, Math.min(1, volume)); this.element.muted = volume === 0;
  }
  toggleMute() { if (this.element) this.element.muted = !this.element.muted; }
  setSpeed(speed: number) { if (this.element && speed > 0 && speed <= 4) this.element.playbackRate = speed; }
  setLoop(loop: boolean) { if (this.element) this.element.loop = loop; this.update({ loop }); }
  preview(start: number, end: number) { this.seek(start); this.previewEnd = end; void this.play(); }
  clearError() { this.update({ error: null }); }
  dispose() {
    this.attach(null); this.removeEvents = null; this.listeners.clear(); this.source = null;
  }
}
