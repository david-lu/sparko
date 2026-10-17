import type { MediaInfo, MediaSource } from '../../media/media';
import { NativeFlowPlayback } from './NativeFlowPlayback';
import type { PlaybackSettings } from '../player/NativeMediaDecks';
import type { CallResponseFlow, Outcome, PlaybackSession, SceneId } from './model';
import { getScene } from './model';

/** Native clip playback for every graph, including the original source ranges. */
export class FlowPlayback {
  private playback: NativeFlowPlayback;
  constructor(readonly flow: CallResponseFlow, video: HTMLVideoElement, source: MediaSource,
    changed: (session: PlaybackSession, buffering: boolean, error?: string) => void, info?: MediaInfo, matchFraming = false) {
    this.playback = new NativeFlowPlayback(flow, video, source, changed, info ?? { width: video.videoWidth || 1280, height: video.videoHeight || 720, duration: 0, fps: flow.fps, codec: 'avc', hasAudio: true }, matchFraming);
  }
  get session() { return this.playback.session; }
  get sourceTime() { const scene = getScene(this.flow, this.session.sceneId); return scene.sourceTime !== undefined && (scene.interstitialId || scene.groupId) ? scene.sourceTime : (scene.clip.inFrame + this.session.frame) / this.flow.fps; }
  get video() { return this.playback.video; }
  setSettings(settings: PlaybackSettings) { this.playback.setSettings(settings); }
  setMatchFraming(value: boolean) { this.playback.setMatchFraming(value); }
  setSubtitles(track: TextTrack | null, cues: VTTCue[], enabled = true) { this.playback.setSubtitles(track, cues, enabled); }
  play() { this.playback.play(); }
  pause() { this.playback.pause(); }
  seekScene(id: SceneId, frame = 0, playing = false) { this.playback.seekScene(id, frame, playing); }
  seek(time: number) { this.playback.seek(time); }
  answer(answer: string) { this.playback.answer(answer); }
  branch(id: SceneId, outcome: Outcome) { this.playback.branch(id, outcome); }
  dispose() { this.playback.dispose(); }
}
