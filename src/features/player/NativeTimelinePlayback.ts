import type { TimelineComposition, TimelineSegment } from '../../media/TimelineComposition';
import { compositionTransitions, segmentTime, transitionWeight } from '../../media/CompositionTransitions';
import { NativeMediaDecks, type NativeClip, type NativeLayer, type PlaybackSettings } from './NativeMediaDecks';

/** A timeline clock over native clips. No source frames are encoded for preview. */
export class NativeTimelinePlayback {
  private decks: NativeMediaDecks;
  private animation = 0;
  private lastTick = performance.now();
  private ready = false;
  private disposed = false;
  private playing = false;
  private time = 0;
  private loop = false;
  private settings: PlaybackSettings;
  private transitions;
  constructor(private composition: TimelineComposition, video: HTMLVideoElement,
    private changed: (time: number, playing: boolean, buffering: boolean, error?: string) => void) {
    this.settings = { volume: video.volume, muted: video.muted, speed: video.playbackRate };
    this.decks = new NativeMediaDecks(video, composition.info, composition.matchFraming);
    this.transitions = composition.crossfade ? compositionTransitions(composition.segments) : [];
    const tick = (now: number) => {
      if (this.disposed) return;
      const elapsed = Math.min(.1, (now - this.lastTick) / 1000); this.lastTick = now;
      if (this.playing && this.ready) {
        this.time = Math.min(composition.duration, this.time + elapsed * this.settings.speed);
        if (this.time >= composition.duration) { if (this.loop) this.time = 0; else this.playing = false; }
      }
      this.render(); this.animation = requestAnimationFrame(tick);
    };
    this.animation = requestAnimationFrame(tick);
  }
  get video() { return this.decks.video; }
  private clip(segment: TimelineSegment, frame: number): NativeClip {
    const original = this.composition.source;
    const sourceFootage = segment.kind === 'source' || segment.source.url === original?.url
      || !!original?.assetId && segment.source.assetId === original.assetId;
    return { key: segment.id, source: segment.source, sourceFootage,
      time: segmentTime(segment, frame, this.composition.fps), still: segment.still, muted: segment.muted };
  }
  private render() {
    const { composition } = this, frame = this.time * composition.fps;
    const transition = this.transitions.find(edge => frame >= edge.startFrame && frame < edge.endFrame);
    const current = composition.at(this.time); if (!current) return;
    let layers: NativeLayer[];
    if (transition) {
      const weight = transitionWeight(transition, frame);
      layers = [{ ...this.clip(transition.before, frame), opacity: 1, gain: 1 - weight },
        { ...this.clip(transition.after, frame), opacity: weight, gain: weight }];
    } else layers = [{ ...this.clip(current, frame), opacity: 1, gain: 1 }];
    try {
      this.ready = this.decks.render(layers, this.playing, this.settings);
      const last = transition?.after ?? current, next = composition.segments[composition.segments.indexOf(last) + 1];
      if (next) this.decks.prepare(this.clip(next, next.startFrame - (composition.crossfade ? 2 : 0)));
      this.changed(this.time, this.playing, !this.ready);
    } catch (error) {
      this.playing = false; this.ready = false; this.decks.pause();
      this.changed(this.time, false, false, error instanceof Error ? error.message : 'Unable to play this clip.');
    }
  }
  play() { if (this.time >= this.composition.duration) this.seek(0); this.playing = true; this.lastTick = performance.now(); this.render(); }
  pause() { this.playing = false; this.decks.pause(); this.render(); }
  seek(time: number) { this.time = Math.max(0, Math.min(this.composition.duration, time)); this.ready = false; this.lastTick = performance.now(); this.render(); }
  setSettings(settings: PlaybackSettings, loop: boolean) { this.settings = settings; this.loop = loop; this.render(); }
  setSubtitles(track: TextTrack | null, cues: VTTCue[], enabled: boolean) { this.decks.setSubtitles(track, cues, enabled); this.render(); }
  dispose() { this.disposed = true; cancelAnimationFrame(this.animation); this.decks.dispose(); }
}
