import type { MediaInfo, MediaSource } from '../../media/media';
import { FrameDecoder } from './FrameDecoder';
import { GpuVideoCanvas } from './GpuVideoCanvas';
import { CanvasAudio } from './CanvasAudio';

export type PlaybackClip = { key: string; source: MediaSource; sourceFootage: boolean; time: number; still?: boolean; muted?: boolean };
export type PlaybackLayer = PlaybackClip & { opacity: number; gain: number; gainRate?: number };
export type PlaybackSettings = { volume: number; muted: boolean; speed: number };
type Deck = { decoder: FrameDecoder; source: string; used: number };

/** Mediabunny decoders feeding one GPU canvas and one audio clock. No preview encoding. */
export class CanvasMediaDecks {
  readonly canvas = document.createElement('canvas');
  private renderer: GpuVideoCanvas;
  private audio = new CanvasAudio();
  private decks = new Map<string, Deck>();
  private active = new Set<string>();
  private counter = 0;
  private originalStyle: string;
  private captions = document.createElement('div');
  private cues: VTTCue[] = [];
  private captionsEnabled = true;
  private track: TextTrack | null = null;
  private signature = '';
  private captionSignature = '';
  private capture?: MediaStream;
  private disposed = false;
  bufferedAhead = 0;
  layers: PlaybackLayer[] = [];
  constructor(private primary: HTMLVideoElement, info: MediaInfo, private matchFraming: boolean) {
    this.originalStyle = primary.style.cssText;
    primary.pause(); primary.style.display = 'none'; primary.removeAttribute('src'); primary.load();
    this.canvas.width = Math.max(2, info.width); this.canvas.height = Math.max(2, info.height);
    this.canvas.className = 'playback-canvas'; this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', primary.getAttribute('aria-label') ?? 'Video preview');
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', cursor: 'pointer' });
    this.canvas.onclick = () => primary.click(); primary.after(this.canvas);
    this.captions.className = 'playback-captions'; this.captions.setAttribute('aria-live', 'off'); this.canvas.after(this.captions);
    this.renderer = new GpuVideoCanvas(this.canvas);
  }
  get video() { return this.primary; }
  elapsed() { return this.audio.elapsed(); }
  private obtain(clip: PlaybackClip) {
    let deck = this.decks.get(clip.key);
    if (deck && deck.source !== clip.source.url) { deck.decoder.dispose(); this.decks.delete(clip.key); deck = undefined; }
    if (!deck) {
      if (this.decks.size >= 3) {
        const unused = [...this.decks].filter(([key]) => !this.active.has(key)).sort((a, b) => a[1].used - b[1].used)[0];
        if (unused) { unused[1].decoder.dispose(); this.decks.delete(unused[0]); }
      }
      deck = { decoder: new FrameDecoder(clip.source, clip.time, this.audio.context.sampleRate), source: clip.source.url, used: ++this.counter }; this.decks.set(clip.key, deck);
    }
    deck.used = ++this.counter; return deck.decoder;
  }
  prepare(clip: PlaybackClip) { if (!this.disposed && !this.active.has(clip.key)) this.obtain(clip).at(clip.time); }
  render(layers: PlaybackLayer[], playing: boolean, settings: PlaybackSettings) {
    if (this.disposed) return false;
    if (this.renderer.error) throw this.renderer.error;
    if (this.audio.error) throw this.audio.error;
    if (playing) this.audio.resume();
    this.layers = layers; this.active = new Set(layers.map(layer => layer.key));
    const assigned = layers.map(layer => { const decoder = this.obtain(layer); return { layer, decoder, sample: decoder.at(layer.time) }; });
    const ready = this.renderer.ready && assigned.every(({ layer, decoder, sample }) => sample && (!playing || layer.still || layer.muted || decoder.audioReady(layer.time)));
    this.bufferedAhead = ready ? Math.max(0, Math.min(...assigned.map(({ layer, decoder }) => decoder.bufferedEnd - layer.time))) : 0;
    if (!ready) { this.audio.pause(); return false; }
    this.canvas.dataset.layerCount = String(layers.length);
    const signature = assigned.map(({ layer, sample }) => `${layer.key}:${sample!.timestamp}:${layer.opacity}`).join('|') + this.matchFraming;
    if (signature !== this.signature) {
      this.renderer.draw(assigned.map(({ layer, sample }) => ({ sample: sample!, opacity: layer.opacity, sourceFootage: layer.sourceFootage })), this.matchFraming);
      this.signature = signature;
    }
    this.audio.retain(playing ? new Set(assigned.filter(({ layer }) => !layer.still && !layer.muted).map(({ layer }) => layer.key)) : new Set());
    for (const { layer, decoder } of assigned) if (playing && !layer.still && !layer.muted) {
      this.audio.render(layer.key, decoder, layer.time, layer.gain, layer.gainRate ?? 0, settings.muted ? 0 : settings.volume, settings.speed);
    }
    const visible = [...layers].reverse().find(layer => layer.opacity >= .5) ?? layers[0];
    const activeCues = this.captionsEnabled && visible?.sourceFootage ? this.cues.filter(cue => cue.startTime <= visible.time && cue.endTime > visible.time) : [];
    const captionSignature = activeCues.map(cue => `${cue.startTime}:${cue.endTime}:${cue.text}`).join('|');
    if (captionSignature !== this.captionSignature) {
      this.captionSignature = captionSignature; this.captions.replaceChildren();
      for (const cue of activeCues) { const line = document.createElement('span'); line.append(cue.getCueAsHTML()); this.captions.append(line); }
    }
    if (this.track) this.track.mode = 'hidden';
    return true;
  }
  setMatchFraming(value: boolean) { this.matchFraming = value; }
  setSubtitles(track: TextTrack | null, cues: VTTCue[], enabled: boolean) { this.track = track; this.cues = cues; this.captionsEnabled = enabled; if (track) track.mode = 'hidden'; }
  async requestPictureInPicture() {
    if (!this.capture) { this.capture = this.canvas.captureStream(); this.primary.srcObject = this.capture; this.primary.muted = true; this.signature = ''; }
    await this.primary.play(); await this.primary.requestPictureInPicture();
  }
  pause() { this.audio.pause(); }
  dispose() {
    this.disposed = true; this.audio.dispose(); this.renderer.dispose(); this.decks.forEach(deck => deck.decoder.dispose()); this.decks.clear();
    this.capture?.getTracks().forEach(track => track.stop()); this.primary.pause(); this.primary.srcObject = null;
    this.canvas.remove(); this.captions.remove(); this.primary.style.cssText = this.originalStyle;
  }
}
