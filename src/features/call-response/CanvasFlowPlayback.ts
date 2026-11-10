import { assets } from '../project/assets';
import { INTERSTITIAL_CROSSFADE_FRAMES } from '../../../shared/constants';
import { fadeLevel } from '../../../shared/fade-curves';
import type { MediaInfo, MediaSource } from '../../media/media';
import { CanvasMediaDecks, type PlaybackClip, type PlaybackLayer, type PlaybackSettings } from '../player/CanvasMediaDecks';
import { advanceSession, answerSession, branchSession, playbackPath, flowLayout, getScene, loopCrossfadeCurve, loopCrossfadeFrames, nextEdge, previewScene, sceneFrames, startSession,
  transitionCurve, type CallResponseFlow, type Outcome, type PlaybackSession, type SceneId } from './model';
import { flowTransition } from './transitions';
import { sceneMediaRange } from '../story-flow/mediaRange';
import type { FadeChannel } from '../story-flow/model';
import idleMusicUrl from '../../../assets/working-something-out-loop.wav?url';
import { playbackAudioLayers } from '../player/audioLayers';

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
        if (frames) this.session = advanceSession(this.flow, this.session, frames, this.crossfade);
      }
      this.render(); this.animation = requestAnimationFrame(tick);
    };
    this.animation = requestAnimationFrame(tick);
  }
  get video() { return this.decks.video; }
  get canvas() { return this.decks.canvas; }
  captureFrame() { return this.decks.captureFrame(); }
  get bufferedAhead() { return this.decks.bufferedAhead; }
  requestPictureInPicture() { return this.decks.requestPictureInPicture(); }
  private clip(session: PlaybackSession, frame = session.frame + this.remainder): PlaybackClip {
    const scene = getScene(this.flow, session.sceneId);
    // Half-clip overlaps meet back-to-back. A third visit can be prepared while
    // the current tail and next head are both still being decoded.
    const visit = session.visit % (scene.clip.kind === 'idle' ? 3 : 2);
    const fullIdle = (this.flow.storyGraph || scene.clip.kind === 'idle') && scene.generated?.fullAssetId && scene.generated.fullRange;
    const context = fullIdle && (frame < 0 || frame >= sceneFrames(scene));
    // Play the saved original range, including its first frame. Older finished
    // loops replaced that frame with a Call still and flash on every repeat.
    const assetId = fullIdle ? scene.generated!.fullAssetId! : scene.clip.assetId;
    const sourceFootage = assetId === this.source.assetId;
    const url = sourceFootage ? this.source.url : assets.url(assetId);
    if (!url) throw new Error('This scene’s media is not available.');
    const source = { ...(sourceFootage ? this.source : { id: assetId, assetId, name: scene.label, url }), volume: scene.volume, kind: this.flow.scenes.find(s => s.storyNode?.source?.assetId === assetId)?.storyNode?.source?.kind ?? (sourceFootage ? this.source.kind : undefined) };
    if (source.kind === 'image') return { key: `${scene.id}:${visit}:body`, sourceFootage: true,
      source: { ...source, kind: 'image' }, time: 0, still: true, muted: true };
    if(this.flow.storyGraph){
      const range=sceneMediaRange(scene,this.flow.fps),bodyStart=range.start;
      const mediaDuration=range.total??(sourceFootage?this.info.duration:scene.clip.outFrame/this.flow.fps);
      const raw=scene.draft?bodyStart:bodyStart+frame/this.flow.fps;
      // The last frame still contains playable audio. Hold/mute only outside
      // the media, not during the fractional frame leading into a repeat.
      const time=raw>=0&&raw<mediaDuration?raw:Math.max(0,Math.min(Math.max(0,mediaDuration-1/this.flow.fps),raw));
      return {key:`${scene.id}:${visit}:body`,sourceFootage,source,
        time,still:scene.draft||time!==raw,muted:scene.draft||time!==raw};
    }
    return { key: `${scene.id}:${visit}:${context ? 'reference' : 'body'}`, sourceFootage,
      muted: !!scene.draft,
      source,
      time: context ? frame < 0 ? scene.generated!.fullRange!.start + frame / this.flow.fps
        : scene.generated!.fullRange!.start + scene.generated!.fullRange!.duration + (frame - sceneFrames(scene)) / this.flow.fps
        : fullIdle ? scene.generated!.fullRange!.start + frame / this.flow.fps
        : scene.draft ? scene.clip.inFrame / this.flow.fps : scene.generated
        ? frame >= sceneFrames(scene) ? scene.generated.start + scene.generated.duration + (frame - sceneFrames(scene)) / this.flow.fps
          : scene.generated.start + frame / this.flow.fps
        : (scene.clip.inFrame + frame) / this.flow.fps, still: scene.draft };
  }
  private layers(): PlaybackLayer[] {
    // Each channel can span a different connection on a short clip. Merge by
    // decoder key so an audio overlap never changes the visible dissolve.
    const video = this.channelLayers('video'), audio = this.channelLayers('audio');
    const layers = video.map(layer => {
      const sound = audio.find(candidate => candidate.key === layer.key);
      return { ...layer, muted: sound?.muted ?? true, gain: sound?.gain ?? 0,
        gainRate: sound?.gainRate ?? 0, musicGain: sound?.musicGain ?? 0 };
    });
    return [...layers, ...audio.filter(layer => !video.some(candidate => candidate.key === layer.key)).map(layer => ({ ...layer, opacity: 0 }))];
  }
  private channelLayers(channel: FadeChannel): PlaybackLayer[] {
    const current = this.session, frame = current.frame + this.remainder;
    const currentClip = this.clip(current);
    const single = [{ ...currentClip, opacity: 1, gain: currentClip.muted ? 0 : 1,
      musicGain: !this.flow.storyGraph && getScene(this.flow, current.sceneId).clip.kind === 'idle' ? 1 : 0 }];
    if (!this.crossfade) return single;
    const outgoing = nextEdge(this.flow, current), scene = getScene(this.flow, current.sceneId);
    if (outgoing?.to === current.sceneId) {
      const frames = loopCrossfadeFrames(scene, this.flow.fps, channel);
      const offset = frame - sceneFrames(scene);
      if (frames && offset >= -frames && offset < 0) {
        const { mix, rate } = fadeLevel(loopCrossfadeCurve(scene, channel), (offset + frames) / frames, this.flow.fps / frames);
        const nextClip = this.clip({ ...current, visit: current.visit + 1 }, offset + loopCrossfadeFrames(scene, this.flow.fps));
        return [{ ...currentClip, opacity: 1, gain: currentClip.muted ? 0 : 1 - mix, gainRate: currentClip.muted ? 0 : -rate,
          musicGain: single[0].musicGain * (1 - mix) },
          { ...nextClip, opacity: mix, gain: nextClip.muted ? 0 : mix, gainRate: nextClip.muted ? 0 : rate,
            musicGain: single[0].musicGain * mix }];
      }
    }
    const previous = current.lastEdgeId ? this.flow.edges.find(edge => edge.id === current.lastEdgeId) : undefined;
    const response = this.flow.interaction.answers.find(answer => answer.id === current.outcome)?.sceneId;
    const incoming = current.lastEdgeId ? previous : this.flow.edges.find(edge => edge.to === current.sceneId && edge.from !== edge.to && (!response || edge.from === response))
      ?? this.flow.edges.find(edge => edge.to === current.sceneId && edge.from !== edge.to);
    for (const [edge, entering] of [[incoming, true], [outgoing, false]] as const) {
      const transition = edge && flowTransition(this.flow, edge, this.crossfadeFrames, channel);
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
      const beforeFrame = !this.flow.storyGraph && transition.before.clip.kind === 'idle' && offset >= 0 && !transition.before.generated?.fullRange
        ? sceneFrames(transition.before) - 1 : sceneFrames(transition.before) + offset;
      const afterFrame = this.flow.storyGraph ? offset : transition.after.clip.kind === 'idle' && offset < 0 && !transition.after.generated?.fullRange ? 0
        : transition.before.clip.kind === 'idle' && offset < 0
          ? Math.max(offset, -Math.floor((transition.after.generated?.start ?? 0) * this.flow.fps + 1e-6)) : offset;
      // The curve shapes the shortened window too, so a late answer keeps the same fade.
      const { mix, rate } = fadeLevel(transitionCurve(edge, channel), weight, this.flow.fps / fadeFrames);
      const beforeClip = this.clip(before, beforeFrame), afterClip = this.clip(after, afterFrame);
      const mutedBeforeCut = afterClip.muted || transition.before.clip.kind === 'idle' && offset < 0 && (!this.flow.storyGraph || beforeClip.muted);
      return [{ ...beforeClip, opacity: 1, gain: beforeClip.muted ? 0 : 1 - mix, gainRate: beforeClip.muted ? 0 : -rate,
        musicGain: !this.flow.storyGraph && transition.before.clip.kind === 'idle' ? 1 - mix : 0 },
        { ...afterClip, muted: mutedBeforeCut, opacity: mix, gain: mutedBeforeCut ? 0 : mix,
          gainRate: mutedBeforeCut ? 0 : rate, musicGain: !this.flow.storyGraph && transition.after.clip.kind === 'idle' ? mix : 0 }];
    }
    return single;
  }
  private render() {
    try {
      const layers = this.layers();
      this.buffering = !this.decks.render(layers, this.session.playing, this.settings,
        layers.reduce((gain, layer) => gain + (layer.musicGain ?? 0), 0),
        playbackAudioLayers(this.flow.audioLayers, (this.session.elapsedFrames + this.remainder) / this.flow.fps));
      if (!this.session.finished) {
        const next = advanceSession(this.flow, { ...this.session, playing: true }, sceneFrames(getScene(this.flow, this.session.sceneId)) - this.session.frame, this.crossfade);
        if (!next.finished) {
          const edge = nextEdge(this.flow, this.session);
          const transition = this.crossfade && edge ? (['video', 'audio'] as const)
            .map(channel => flowTransition(this.flow, edge, this.crossfadeFrames, channel))
            .filter(t => !!t).sort((a, b) => a.startFrame - b.startFrame)[0] : undefined;
          const prepareFrame = transition?.after.clip.kind === 'idle' ? transition.after.generated?.fullRange ? transition.startFrame : 0 : transition?.before.clip.kind === 'idle'
            ? Math.max(transition.startFrame, -Math.floor((transition.after.generated?.start ?? 0) * this.flow.fps + 1e-6))
            : transition?.startFrame ?? 0;
          this.decks.prepare(this.clip(next, prepareFrame));
          if (this.crossfade && next.sceneId === this.session.sceneId && nextEdge(this.flow, next)?.to === next.sceneId) {
            const overlap = loopCrossfadeFrames(getScene(this.flow, next.sceneId), this.flow.fps);
            if (overlap && this.session.frame + this.remainder >= sceneFrames(getScene(this.flow, next.sceneId)) - overlap) {
              this.decks.prepare(this.clip({ ...next, visit: next.visit + 1 }, 0));
            }
          }
        }
      }
      this.changed(this.session, this.buffering);
    } catch (error) {
      this.session = { ...this.session, playing: false }; this.buffering = false; this.decks.pause();
      this.changed(this.session, false, error instanceof Error ? error.message : 'Unable to play this scene.');
    }
  }
  setSettings(settings: PlaybackSettings) { this.settings = settings; this.render(); }
  setFlow(flow: CallResponseFlow) { this.flow = flow;
    const scene=getScene(flow,this.session.sceneId);
    this.session=scene?{...this.session,frame:Math.min(this.session.frame,sceneFrames(scene)-1)}:startSession(flow);
    this.render(); }
  setCrossfade(value: boolean, frames = this.crossfadeFrames) { this.crossfade = value; this.crossfadeFrames = frames; this.render(); }
  setSubtitles(track: TextTrack | null, cues: VTTCue[], enabled = true) {
    this.subtitles = { track, cues, enabled }; this.decks.setSubtitles(track, cues, enabled); this.render();
  }
  setMatchFraming(value: boolean) {
    if (value === this.matchFraming) return;
    this.matchFraming = value; this.decks.setMatchFraming(value); this.render();
  }
  play() {
    if (this.session.finished) { this.session = startSession(this.flow, true); this.remainder = 0; }
    else this.session = { ...this.session, playing: true };
    this.decks.elapsed(); this.render();
  }
  pause() { this.session = { ...this.session, playing: false }; this.decks.pause(); this.render(); }
  restoreSession(session: PlaybackSession) {
    const scene = getScene(this.flow, session.sceneId);
    this.session = { ...session, frame: Math.max(0, Math.min(sceneFrames(scene) - 1, session.frame)), playing: false,
      traversedEdgeIds: session.traversedEdgeIds?.filter(id => this.flow.edges.some(edge => edge.id === id)) };
    this.remainder = 0; this.buffering = true; this.decks.pause(); this.render();
  }
  seekScene(id: SceneId, frame = 0, playing = false, preserveRoute = false) {
    const scene = getScene(this.flow, id);
    const targetFrame = Math.max(0, Math.min(sceneFrames(scene) - 1, Math.round(frame)));
    const route = preserveRoute ? { traversedEdgeIds: this.session.traversedEdgeIds,
      outcome: scene.clip.kind === 'idle' ? null : this.session.outcome } : {};
    this.session = { ...previewScene(this.flow, id), ...route, frame: targetFrame,
      elapsedFrames: (flowLayout(this.flow).starts[id] ?? 0) + targetFrame, playing };
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
