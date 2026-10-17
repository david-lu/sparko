import type { MediaInfo, MediaSource } from '../../media/media';
import { GeneratedPlaybackMedia } from '../../media/GeneratedPlaybackMedia';
import { remapSubtitles } from './subtitles';

export type NativeClip = { key: string; source: MediaSource; sourceFootage: boolean; time: number; still?: boolean; muted?: boolean };
export type NativeLayer = NativeClip & { opacity: number; gain: number };
export type PlaybackSettings = { volume: number; muted: boolean; speed: number };
type Deck = { video: HTMLVideoElement; key: string; loaded: boolean; error?: string; clip?: NativeClip; token: number; track?: TextTrack };

/** Three native decoders: two for a dissolve, and one to seek the next clip ahead of time. */
export class NativeMediaDecks {
  private decks: Deck[];
  private media: GeneratedPlaybackMedia;
  private disposed = false;
  private activeKeys = new Set<string>();
  private originalStyle: string;
  private track: TextTrack | null = null;
  private cues: VTTCue[] = [];
  private captions = true;
  private current: HTMLVideoElement;
  constructor(private primary: HTMLVideoElement, info: MediaInfo, matchFraming: boolean) {
    this.originalStyle = primary.style.cssText; this.current = primary;
    this.media = new GeneratedPlaybackMedia(info, matchFraming);
    this.decks = [primary, ...Array.from({ length: 2 }, () => {
      const video = primary.cloneNode(false) as HTMLVideoElement;
      video.removeAttribute('src'); video.removeAttribute('aria-label'); video.removeAttribute('id');
      video.setAttribute('aria-hidden', 'true'); video.style.pointerEvents = 'none';
      primary.after(video); return video;
    })].map(video => {
      video.pause(); video.loop = false; video.preload = 'auto'; video.playsInline = true;
      Object.assign(video.style, { opacity: '0', background: '#000', zIndex: '0' });
      video.dataset.nativeDeck = '';
      return { video, key: '', loaded: false, token: 0 };
    });
  }
  get video() { return this.current; }
  prepareMedia(clip: NativeClip) { if (!clip.sourceFootage) void this.media.resolve(clip.source).catch(() => undefined); }
  prepare(clip: NativeClip) {
    if (this.disposed) return;
    const deck = this.obtain(clip);
    if (deck && !this.activeKeys.has(deck.key)) this.position(deck, clip.time, false);
  }
  private obtain(clip: NativeClip): Deck | undefined {
    const existing = this.decks.find(deck => deck.key === clip.key);
    if (existing) return existing;
    const deck = this.decks.find(deck => !this.activeKeys.has(deck.key) && !deck.key)
      ?? this.decks.find(deck => !this.activeKeys.has(deck.key));
    if (!deck) return;
    const token = ++deck.token;
    deck.video.pause(); deck.key = clip.key; deck.clip = clip; deck.loaded = false; deck.error = undefined;
    const resolved = clip.sourceFootage ? Promise.resolve(clip.source.url) : this.media.resolve(clip.source);
    void resolved.then(url => {
      if (this.disposed || deck.token !== token) return;
      if (deck.video.src !== url || deck.video.readyState < 1) deck.video.addEventListener('loadedmetadata', () => {
        if (!this.disposed && deck.token === token) this.position(deck, clip.time, false);
      }, { once: true });
      if (deck.video.src !== url) { deck.video.src = url; deck.video.load(); }
      deck.loaded = true;
      this.position(deck, clip.time, false);
    }).catch(error => { if (!this.disposed && deck.token === token) deck.error = error instanceof Error ? error.message : 'Unable to load this clip.'; });
    return deck;
  }
  private position(deck: Deck, time: number, playing: boolean) {
    const video = deck.video;
    if (!deck.loaded || video.readyState < 1) return false;
    const target = Math.max(0, Math.min(Math.max(0, video.duration - .001), time));
    // Native decoders own the frame clock. Correct only material drift while playing.
    if (!video.seeking && Math.abs(video.currentTime - target) > (playing ? .12 : .001)) video.currentTime = target;
    return video.readyState >= 2 && !video.seeking;
  }
  render(layers: NativeLayer[], playing: boolean, settings: PlaybackSettings): boolean {
    this.activeKeys = new Set(layers.map(layer => layer.key));
    const assigned = layers.map(layer => ({ layer, deck: this.obtain(layer)! }));
    let ready = true;
    for (const { layer, deck } of assigned) {
      if (deck.error || deck.loaded && deck.video.error) throw new Error(deck.error ?? `Unable to play ${layer.source.name}.`);
      if (!this.position(deck, layer.time, playing && !layer.still)) ready = false;
    }
    for (const deck of this.decks) {
      const index = assigned.findIndex(item => item.deck === deck), layer = assigned[index]?.layer;
      if (!layer || !ready) deck.video.pause();
      if (!layer) { deck.video.style.opacity = '0'; deck.video.volume = 0; if (deck.track) deck.track.mode = 'hidden'; continue; }
      const video = deck.video;
      video.style.opacity = String(layer.opacity); video.style.zIndex = String(index);
      video.dataset.clip = layer.key;
      video.muted = settings.muted || !!layer.muted || !!layer.still || layer.time < 0 || layer.time >= video.duration;
      video.volume = Math.max(0, Math.min(1, settings.volume * layer.gain)); video.playbackRate = settings.speed;
      const track = video === this.primary ? this.track : deck.track;
      if (track) track.mode = this.captions && layer.sourceFootage ? 'showing' : 'hidden';
      const hold = layer.still || layer.time < 0 || layer.time >= video.duration - .001;
      if (!playing || !ready || hold) video.pause();
      else if (video.paused) void video.play().catch(error => { if (!this.disposed && error.name !== 'AbortError') deck.error = 'Press Play to start this clip.'; });
    }
    const visible = [...assigned].reverse().find(item => item.layer.gain >= .5)?.deck.video ?? assigned[0]?.deck.video;
    if (ready && visible && visible !== this.current) {
      const pip = document.pictureInPictureElement === this.current;
      this.current = visible;
      if (pip && ready) void visible.requestPictureInPicture().catch(() => document.exitPictureInPicture().catch(() => undefined));
    }
    return ready;
  }
  setSubtitles(track: TextTrack | null, cues: VTTCue[], enabled: boolean) {
    this.track = track; this.cues = cues; this.captions = enabled;
    if (track) remapSubtitles(track, cues, null);
    for (const deck of this.decks) if (deck.video !== this.primary) {
      if (!deck.track && cues.length) deck.track = deck.video.addTextTrack('subtitles', 'Source captions');
      if (deck.track) { deck.track.mode = 'hidden'; remapSubtitles(deck.track, this.cues, null); }
    }
  }
  pause() { this.decks.forEach(deck => deck.video.pause()); }
  dispose() {
    this.disposed = true; this.pause(); this.media.dispose();
    for (const deck of this.decks) {
      delete deck.video.dataset.nativeDeck; delete deck.video.dataset.clip;
      if (deck.video !== this.primary) { deck.video.removeAttribute('src'); deck.video.load(); deck.video.remove(); }
    }
    this.primary.style.cssText = this.originalStyle;
  }
}
