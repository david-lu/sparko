import { assets } from '../project/assets';
import { INTERSTITIAL_CROSSFADE_FRAMES } from '../../../shared/constants';
import type { MediaInfo, MediaSource } from '../../media/media';
import { CanvasMediaDecks, type PlaybackClip, type PlaybackLayer, type PlaybackSettings } from '../player/CanvasMediaDecks';
import { advanceSession, answerSession, branchSession, playbackPath, flowLayout, getScene, nextEdge, previewScene, sceneFrames, startSession,
  type CallResponseFlow, type Outcome, type PlaybackSession, type SceneId } from './model';
import { flowTransition } from './transitions';
import idleMusicUrl from '../../../assets/working-something-out-loop.wav?url';

/** Scene playback through the shared Mediabunny/GPU renderer and audio clock. */
export class CanvasFlowPlayback {
  session: PlaybackSession;
  private decks: CanvasMediaDecks;
  private animation = 0;
  private buffering = true;
  private disposed = false;
  private remainder = 0;
  private settings: PlaybackSettings;
  private subtitles: { track: TextTrack | null; cues: VTTCue[]; enabled: boolean } = { track: null, cues: [], enabled: true };
  constructor(public flow: CallResponseFlow, private primary: HTMLVideoElement, private source: MediaSource,
    private changed: (session: PlaybackSession, buffering: boolean, error?: string) => void, private info: MediaInfo, private matchFraming = false, private crossfade = true, private crossfadeFrames = INTERSTITIAL_CROSSFADE_FRAMES) {
    this.session = startSession(flow);
    this.settings = { volume: primary.volume, muted: primary.muted, speed: primary.playbackRate };
    this.decks = new CanvasMediaDecks(primary, info, matchFraming);
    this.decks.prepareMusic(idleMusicUrl);
    const tick = () => {
      if (this.disposed) return;
      const elapsed = this.decks.elapsed();
      if (this.session.playing && !this.buffering) {
        this.remainder += elapsed * this.flow.fps * this.settings.speed;
        const frames = Math.floor(this.remainder); this.remainder -= frames;
        if (frames) this.session = advanceSession(this.flow, this.session, frames);
      }
      this.render(); this.animation = requestAnimationFrame(tick);
    };
    this.animation = requestAnimationFrame(tick);
  }
  get video() { return this.decks.video; }
  get canvas() { return this.decks.canvas; }
  get bufferedAhead() { return this.decks.bufferedAhead; }
  requestPictureInPicture() { return this.decks.requestPictureInPicture(); }
  private clip(session: PlaybackSession, frame = session.frame + this.remainder): PlaybackClip {
    const scene = getScene(this.flow, session.sceneId);
    const fullIdle = scene.clip.kind === 'idle' && scene.generated?.fullAssetId && scene.generated.fullRange;
    const context = fullIdle && (frame < 0 || frame >= sceneFrames(scene));
    // Play the saved original range, including its first frame. Older finished
    // loops replaced that frame with a Call still and flash on every repeat.
    const assetId = fullIdle ? scene.generated!.fullAssetId! : scene.clip.assetId;
    const sourceFootage = assetId === this.source.assetId;
    const url = sourceFootage ? this.source.url : assets.url(assetId);
    if (!url) throw new Error('This scene’s media is not available.');
    return { key: `${scene.id}:${session.visit % 2}:${context ? 'reference' : 'body'}`, sourceFootage,
      muted: scene.clip.kind === 'idle' && !(scene.loopAudio && fullIdle),
      source: sourceFootage ? this.source : { id: assetId, assetId, name: scene.label, url },
      time: context ? frame < 0 ? scene.generated!.fullRange!.start + frame / this.flow.fps
        : scene.generated!.fullRange!.start + scene.generated!.fullRange!.duration + (frame - sceneFrames(scene)) / this.flow.fps
        : fullIdle ? scene.generated!.fullRange!.start + frame / this.flow.fps
        : scene.draft ? scene.clip.inFrame / this.flow.fps : scene.generated
        ? frame >= sceneFrames(scene) ? scene.generated.start + scene.generated.duration + (frame - sceneFrames(scene)) / this.flow.fps
          : scene.generated.start + frame / this.flow.fps
        : (scene.clip.inFrame + frame) / this.flow.fps, still: scene.draft };
  }
  private layers(): PlaybackLayer[] {
    const current = this.session, frame = current.frame + this.remainder;
    const currentClip = this.clip(current);
    const single = [{ ...currentClip, opacity: 1, gain: currentClip.muted ? 0 : 1,
      musicGain: getScene(this.flow, current.sceneId).clip.kind === 'idle' ? 1 : 0 }];
    if (!this.crossfade) return single;
    const previous = current.lastEdgeId ? this.flow.edges.find(edge => edge.id === current.lastEdgeId) : undefined;
    const response = this.flow.interaction.answers.find(answer => answer.id === current.outcome)?.sceneId;
    const incoming = current.lastEdgeId ? previous : this.flow.edges.find(edge => edge.to === current.sceneId && edge.from !== edge.to && (!response || edge.from === response))
      ?? this.flow.edges.find(edge => edge.to === current.sceneId && edge.from !== edge.to);
    const outgoing = nextEdge(this.flow, current);
    for (const [edge, entering] of [[incoming, true], [outgoing, false]] as const) {
      const transition = edge && flowTransition(this.flow, edge, this.crossfadeFrames);
      if (!transition) continue;
      const offset = entering ? frame : frame - sceneFrames(transition.before);
      // An answer chosen during the fade window only uses the Idle frames that remain.
      const fadeStart = !entering && transition.before.clip.kind === 'idle' && current.outcomeQueuedFrame !== undefined
        ? Math.max(transition.startFrame, current.outcomeQueuedFrame - sceneFrames(transition.before)) : transition.startFrame;
      const fadeFrames = transition.startFrame < 0 && fadeStart > transition.startFrame ? -fadeStart : transition.frames;
      const weight = (offset - fadeStart) / fadeFrames;
      if (weight < 0 || weight >= 1) continue;
      const before = { ...current, sceneId: transition.before.id, visit: entering ? Math.max(0, current.visit - 1) : current.visit };
      const after = { ...current, sceneId: transition.after.id, visit: entering ? current.visit : current.visit + 1 };
      // Match the tail of Idle's body to the saved prefix of this Response.
      const beforeFrame = transition.before.clip.kind === 'idle' && offset >= 0 && !transition.before.generated?.fullRange
        ? sceneFrames(transition.before) - 1 : sceneFrames(transition.before) + offset;
      const afterFrame = transition.after.clip.kind === 'idle' && offset < 0 && !transition.after.generated?.fullRange ? 0
        : transition.before.clip.kind === 'idle' && offset < 0
          ? Math.max(offset, -Math.floor((transition.after.generated?.start ?? 0) * this.flow.fps + 1e-6)) : offset;
      const rate = this.flow.fps / fadeFrames;
      const beforeClip = this.clip(before, beforeFrame), afterClip = this.clip(after, afterFrame);
      const mutedBeforeCut = afterClip.muted || transition.before.clip.kind === 'idle' && offset < 0;
      return [{ ...beforeClip, opacity: 1, gain: beforeClip.muted ? 0 : 1 - weight, gainRate: beforeClip.muted ? 0 : -rate,
        musicGain: transition.before.clip.kind === 'idle' ? 1 - weight : 0 },
        { ...afterClip, muted: mutedBeforeCut, opacity: weight, gain: mutedBeforeCut ? 0 : weight,
          gainRate: mutedBeforeCut ? 0 : rate, musicGain: transition.after.clip.kind === 'idle' ? weight : 0 }];
    }
    return single;
  }
  private render() {
    try {
      const layers = this.layers();
      this.buffering = !this.decks.render(layers, this.session.playing, this.settings,
        layers.reduce((gain, layer) => gain + (layer.musicGain ?? 0), 0));
      if (!this.session.finished) {
        const next = advanceSession(this.flow, { ...this.session, playing: true }, sceneFrames(getScene(this.flow, this.session.sceneId)) - this.session.frame);
        if (!next.finished) {
          const edge = nextEdge(this.flow, this.session), transition = this.crossfade && edge ? flowTransition(this.flow, edge, this.crossfadeFrames) : undefined;
          const prepareFrame = transition?.after.clip.kind === 'idle' ? transition.after.generated?.fullRange ? transition.startFrame : 0 : transition?.before.clip.kind === 'idle'
            ? Math.max(transition.startFrame, -Math.floor((transition.after.generated?.start ?? 0) * this.flow.fps + 1e-6))
            : transition?.startFrame ?? 0;
          this.decks.prepare(this.clip(next, prepareFrame));
        }
      }
      this.changed(this.session, this.buffering);
    } catch (error) {
      this.session = { ...this.session, playing: false }; this.buffering = false; this.decks.pause();
      this.changed(this.session, false, error instanceof Error ? error.message : 'Unable to play this scene.');
    }
  }
  setSettings(settings: PlaybackSettings) { this.settings = settings; this.render(); }
  setFlow(flow: CallResponseFlow) { this.flow = flow; this.render(); }
  setCrossfade(value: boolean, frames = this.crossfadeFrames) { this.crossfade = value; this.crossfadeFrames = frames; this.render(); }
  setSubtitles(track: TextTrack | null, cues: VTTCue[], enabled = true) {
    this.subtitles = { track, cues, enabled }; this.decks.setSubtitles(track, cues, enabled); this.render();
  }
  setMatchFraming(value: boolean) {
    if (value === this.matchFraming) return;
    this.matchFraming = value; this.decks.setMatchFraming(value); this.render();
  }
  play() {
    if (this.session.finished) this.session = startSession(this.flow, true);
    else this.session = { ...this.session, playing: true };
    this.decks.elapsed(); this.render();
  }
  pause() { this.session = { ...this.session, playing: false }; this.decks.pause(); this.render(); }
  seekScene(id: SceneId, frame = 0, playing = false) {
    this.session = { ...previewScene(this.flow, id), frame: Math.max(0, Math.min(sceneFrames(getScene(this.flow, id)) - 1, Math.round(frame))), playing };
    this.remainder = 0; this.buffering = true; this.decks.pause(); this.render();
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
