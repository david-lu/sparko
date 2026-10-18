import type { MediaInfo, MediaSource } from '../../media/media';
import { CanvasFlowPlayback } from './CanvasFlowPlayback';
import type { PlaybackSettings } from '../player/CanvasMediaDecks';
import type { CallResponseFlow, Outcome, PlaybackSession, SceneId } from './model';
import { getScene } from './model';

/** Canvas playback for every graph, including the original source ranges. */
export class FlowPlayback {
  private playback: CanvasFlowPlayback;
  constructor(public flow: CallResponseFlow, video: HTMLVideoElement, source: MediaSource,
    changed: (session: PlaybackSession, buffering: boolean, error?: string) => void, info?: MediaInfo, matchFraming = false, crossfade = true, crossfadeFrames?: number) {
    this.playback = new CanvasFlowPlayback(flow, video, source, changed, info ?? { width: video.videoWidth || 1280, height: video.videoHeight || 720, duration: 0, fps: flow.fps, codec: 'avc', hasAudio: true }, matchFraming, crossfade, crossfadeFrames);
  }
  get session() { return this.playback.session; }
  get sourceTime() { const scene = getScene(this.flow, this.session.sceneId); return scene.sourceTime !== undefined && (scene.interstitialId || scene.groupId) ? scene.sourceTime : (scene.clip.inFrame + this.session.frame) / this.flow.fps; }
  get video() { return this.playback.video; }
  get canvas() { return this.playback.canvas; }
  get bufferedAhead() { return this.playback.bufferedAhead; }
  requestPictureInPicture() { return this.playback.requestPictureInPicture(); }
  setSettings(settings: PlaybackSettings) { this.playback.setSettings(settings); }
  setFlow(flow: CallResponseFlow) { this.flow = flow; this.playback.setFlow(flow); }
  setMatchFraming(value: boolean) { this.playback.setMatchFraming(value); }
  setCrossfade(value: boolean, frames?: number) { this.playback.setCrossfade(value, frames); }
  setSubtitles(track: TextTrack | null, cues: VTTCue[], enabled = true) { this.playback.setSubtitles(track, cues, enabled); }
  play() { this.playback.play(); }
  pause() { this.playback.pause(); }
  seekScene(id: SceneId, frame = 0, playing = false) { this.playback.seekScene(id, frame, playing); }
  seek(time: number) { this.playback.seek(time); }
  answer(answer: string) { this.playback.answer(answer); }
  branch(id: SceneId, outcome: Outcome) { this.playback.branch(id, outcome); }
  dispose() { this.playback.dispose(); }
}
