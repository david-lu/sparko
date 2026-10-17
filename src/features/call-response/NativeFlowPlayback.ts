import { assets } from '../project/assets';
import type { MediaSource } from '../../media/media';
import { advanceSession, answerSession, branchSession, playbackPath, flowLayout, getScene, previewScene, sceneFrames, startSession,
  type CallResponseFlow, type Outcome, type PlaybackSession, type SceneId } from './model';

/** Plays the graph's real asset ranges in the editor's existing video element. */
export class NativeFlowPlayback {
  session: PlaybackSession;
  private positionTask: AbortController | null = null;
  private animation = 0;
  private buffering = false;
  private disposed = false;
  private lastTick = performance.now();
  private onMedia = () => this.sync();
  constructor(readonly flow: CallResponseFlow, private video: HTMLVideoElement, private source: MediaSource,
    private changed: (session: PlaybackSession, buffering: boolean, error?: string) => void) {
    this.session = startSession(flow);
    video.loop = false;
    for (const event of ['timeupdate', 'ended', 'play', 'pause']) video.addEventListener(event, this.onMedia);
    const tick = () => {
      if (this.disposed) return;
      const now = performance.now(), elapsed = now - this.lastTick;
      if (getScene(this.flow, this.session.sceneId).draft && this.session.playing && !this.buffering) {
        const frames = Math.floor(elapsed * this.flow.fps / 1000);
        if (frames) {
          this.lastTick += frames * 1000 / this.flow.fps;
          const visit = this.session.visit; this.session = advanceSession(this.flow, this.session, frames);
          if (visit !== this.session.visit) this.position(); else this.emit();
        }
      } else { this.lastTick = now; this.sync(); }
      this.animation = requestAnimationFrame(tick);
    };
    this.animation = requestAnimationFrame(tick);
    this.position();
  }
  private emit(error?: string) { this.changed(this.session, this.buffering, error); }
  private sync() {
    if (this.disposed || this.buffering || this.video.seeking || this.session.finished) return;
    const scene = getScene(this.flow, this.session.sceneId);
    if (scene.draft) return;
    const frame = Math.max(0, Math.min(sceneFrames(scene), Math.floor(this.video.currentTime * this.flow.fps + 1e-4) - scene.clip.inFrame));
    if (frame === this.session.frame) return;
    if (!this.session.playing) { this.session = { ...this.session, frame }; this.emit(); return; }
    const previous = this.session;
    this.session = advanceSession(this.flow, previous, Math.max(0, frame - previous.frame));
    if (this.session.finished) { this.video.pause(); this.emit(); return; }
    if (this.session.visit !== previous.visit) this.position();
    else this.emit();
  }
  private position() {
    this.positionTask?.abort();
    const operation = new AbortController(); this.positionTask = operation;
    const scene = getScene(this.flow, this.session.sceneId);
    if (scene.draft) this.video.pause();
    this.lastTick = performance.now();
    const url = scene.clip.assetId === this.source.assetId ? this.source.url : assets.url(scene.clip.assetId);
    if (!url) { this.session = { ...this.session, playing: false }; this.buffering = false; this.emit('This scene’s media is not available.'); return; }
    this.buffering = true; this.emit();
    const ready = () => {
      if (operation.signal.aborted || this.disposed) return;
      this.buffering = false; this.emit();
      if (this.session.playing && !scene.draft) void this.video.play().catch(() => { this.session = { ...this.session, playing: false }; this.emit('Press Play to start this scene.'); });
    };
    const seek = () => {
      const time = (scene.clip.inFrame + (scene.draft ? 0 : this.session.frame)) / this.flow.fps;
      if (Math.abs(this.video.currentTime - time) < .001) { ready(); return; }
      this.video.addEventListener('seeked', ready, { once: true, signal: operation.signal });
      this.video.currentTime = time;
    };
    if (this.video.src !== url) {
      this.video.addEventListener('loadedmetadata', seek, { once: true, signal: operation.signal });
      this.video.src = url; this.video.load();
    } else if (this.video.readyState >= 1) seek();
    else this.video.addEventListener('loadedmetadata', seek, { once: true, signal: operation.signal });
  }
  play() {
    if (this.session.finished) { this.session = startSession(this.flow, true); this.position(); return; }
    this.session = { ...this.session, playing: true }; this.emit();
    this.lastTick = performance.now();
    if (!this.buffering && !getScene(this.flow, this.session.sceneId).draft) void this.video.play().catch(() => { this.session = { ...this.session, playing: false }; this.emit('Press Play to start this scene.'); });
  }
  pause() { this.session = { ...this.session, playing: false }; this.video.pause(); this.emit(); }
  seekScene(id: SceneId, frame = 0, playing = false) {
    this.session = { ...previewScene(this.flow, id), frame: Math.max(0, Math.min(sceneFrames(getScene(this.flow, id)) - 1, Math.round(frame))), playing };
    if (!playing) this.video.pause();
    this.position();
  }
  seek(time: number) {
    const layout = flowLayout(this.flow), frame = Math.max(0, time * this.flow.fps);
    const answer = this.flow.interaction.answers.find(answer => answer.id === this.session.outcome || answer.sceneId === this.session.sceneId);
    const path = playbackPath(this.flow, this.session);
    const id = [...path].reverse().find(id => frame >= layout.starts[id]) ?? this.flow.entrySceneId;
    this.seekScene(id, frame - layout.starts[id], this.session.playing);
    if (answer && getScene(this.flow, id).clip.kind !== 'idle') { this.session = { ...this.session, outcome: answer.id }; this.emit(); }
  }
  answer(answer: string) { this.session = answerSession(this.flow, this.session, answer); this.emit(); }
  branch(id: SceneId, outcome: Outcome) {
    if (getScene(this.flow, id).clip.kind !== 'idle') return;
    if (this.session.sceneId !== id || this.session.outcome || this.session.finished) this.seekScene(id);
    this.session = branchSession(this.flow, this.session, outcome); this.play();
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.animation); this.positionTask?.abort();
    for (const event of ['timeupdate', 'ended', 'play', 'pause']) this.video.removeEventListener(event, this.onMedia);
  }
}
