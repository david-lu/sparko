import { assets } from '../project/assets';
import type { MediaInfo, MediaSource } from '../../media/media';
import { NativeMediaDecks, type NativeClip, type PlaybackSettings } from '../player/NativeMediaDecks';
import { advanceSession, answerSession, branchSession, playbackPath, flowLayout, getScene, previewScene, sceneFrames, startSession,
  type CallResponseFlow, type Outcome, type PlaybackSession, type SceneId } from './model';

/** Native scene playback, with generated clips prepared once to the source's cadence and dimensions. */
export class NativeFlowPlayback {
  session: PlaybackSession;
  private decks: NativeMediaDecks;
  private animation = 0;
  private buffering = true;
  private disposed = false;
  private lastTick = performance.now();
  private remainder = 0;
  private settings: PlaybackSettings;
  private subtitles: { track: TextTrack | null; cues: VTTCue[]; enabled: boolean } = { track: null, cues: [], enabled: true };
  constructor(readonly flow: CallResponseFlow, private primary: HTMLVideoElement, private source: MediaSource,
    private changed: (session: PlaybackSession, buffering: boolean, error?: string) => void, private info: MediaInfo, private matchFraming = false) {
    this.session = startSession(flow);
    this.settings = { volume: primary.volume, muted: primary.muted, speed: primary.playbackRate };
    this.decks = new NativeMediaDecks(primary, info, matchFraming);
    this.prepareMedia();
    const tick = (now: number) => {
      if (this.disposed) return;
      const elapsed = Math.min(.1, (now - this.lastTick) / 1000); this.lastTick = now;
      if (this.session.playing && !this.buffering) {
        this.remainder += elapsed * flow.fps * this.settings.speed;
        const frames = Math.floor(this.remainder); this.remainder -= frames;
        if (frames) this.session = advanceSession(flow, this.session, frames);
      }
      this.render(); this.animation = requestAnimationFrame(tick);
    };
    this.animation = requestAnimationFrame(tick);
  }
  get video() { return this.decks.video; }
  private prepareMedia() {
    for (const scene of this.flow.scenes) {
      try { this.decks.prepareMedia(this.clip({ ...this.session, sceneId: scene.id, frame: 0 })); }
      catch { /* Missing alternatives report their error when selected. */ }
    }
  }
  private clip(session: PlaybackSession): NativeClip {
    const scene = getScene(this.flow, session.sceneId), sourceFootage = scene.clip.assetId === this.source.assetId;
    const url = sourceFootage ? this.source.url : assets.url(scene.clip.assetId);
    if (!url) throw new Error('This scene’s media is not available.');
    return { key: `${scene.id}:${session.visit % 2}`, sourceFootage,
      source: sourceFootage ? this.source : { id: scene.clip.assetId, assetId: scene.clip.assetId, name: scene.label, url },
      time: (scene.clip.inFrame + (scene.draft ? 0 : session.frame + this.remainder)) / this.flow.fps, still: scene.draft };
  }
  private render() {
    try {
      const clip = this.clip(this.session);
      this.buffering = !this.decks.render([{ ...clip, opacity: 1, gain: 1 }], this.session.playing, this.settings);
      if (!this.session.finished) {
        const next = advanceSession(this.flow, { ...this.session, playing: true }, sceneFrames(getScene(this.flow, this.session.sceneId)) - this.session.frame);
        if (!next.finished) this.decks.prepare(this.clip({ ...next, frame: 0 }));
      }
      this.changed(this.session, this.buffering);
    } catch (error) {
      this.session = { ...this.session, playing: false }; this.buffering = false; this.decks.pause();
      this.changed(this.session, false, error instanceof Error ? error.message : 'Unable to play this scene.');
    }
  }
  setSettings(settings: PlaybackSettings) { this.settings = settings; this.render(); }
  setSubtitles(track: TextTrack | null, cues: VTTCue[], enabled = true) {
    this.subtitles = { track, cues, enabled }; this.decks.setSubtitles(track, cues, enabled); this.render();
  }
  setMatchFraming(value: boolean) {
    if (value === this.matchFraming) return;
    this.matchFraming = value; this.decks.dispose();
    this.decks = new NativeMediaDecks(this.primary, this.info, value);
    this.prepareMedia();
    this.decks.setSubtitles(this.subtitles.track, this.subtitles.cues, this.subtitles.enabled);
    this.buffering = true; this.render();
  }
  play() {
    if (this.session.finished) this.session = startSession(this.flow, true);
    else this.session = { ...this.session, playing: true };
    this.lastTick = performance.now(); this.render();
  }
  pause() { this.session = { ...this.session, playing: false }; this.decks.pause(); this.render(); }
  seekScene(id: SceneId, frame = 0, playing = false) {
    this.session = { ...previewScene(this.flow, id), frame: Math.max(0, Math.min(sceneFrames(getScene(this.flow, id)) - 1, Math.round(frame))), playing };
    this.remainder = 0; this.buffering = true; this.lastTick = performance.now(); this.render();
  }
  seek(time: number) {
    const layout = flowLayout(this.flow), frame = Math.max(0, time * this.flow.fps);
    const answer = this.flow.interaction.answers.find(answer => answer.id === this.session.outcome || answer.sceneId === this.session.sceneId);
    const path = playbackPath(this.flow, this.session);
    const id = [...path].reverse().find(id => frame >= layout.starts[id]) ?? this.flow.entrySceneId;
    this.seekScene(id, frame - layout.starts[id], this.session.playing);
    if (answer && getScene(this.flow, id).clip.kind !== 'idle') { this.session = { ...this.session, outcome: answer.id }; this.render(); }
  }
  answer(answer: string) { this.session = answerSession(this.flow, this.session, answer); this.render(); }
  branch(id: SceneId, outcome: Outcome) {
    if (getScene(this.flow, id).clip.kind !== 'idle') return;
    if (this.session.sceneId !== id || this.session.outcome || this.session.finished) this.seekScene(id);
    this.session = branchSession(this.flow, this.session, outcome); this.play();
  }
  dispose() { this.disposed = true; cancelAnimationFrame(this.animation); this.decks.dispose(); }
}
