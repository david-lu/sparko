import type { MediaInfo, MediaSource } from '../../media/media';
import { COMPOSITION_MIME } from '../../media/CompositionRenderer';
import { BufferedFlowPlayback } from './BufferedFlowPlayback';
import { NativeFlowPlayback } from './NativeFlowPlayback';
import { remapSubtitles } from '../player/subtitles';
import type { CallResponseFlow, Outcome, PlaybackSession, SceneId } from './model';
import { getScene } from './model';

/** Continuous buffered playback, retaining native clip playback where MSE is unavailable. */
export class FlowPlayback {
  private playback: BufferedFlowPlayback | NativeFlowPlayback;
  constructor(readonly flow: CallResponseFlow, video: HTMLVideoElement, source: MediaSource,
    changed: (session: PlaybackSession, buffering: boolean, error?: string) => void, info?: MediaInfo) {
    this.playback = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(COMPOSITION_MIME)
      ? new BufferedFlowPlayback(flow, video, source, changed, info ?? { width: video.videoWidth || 1280, height: video.videoHeight || 720, duration: 0, fps: flow.fps, codec: 'avc', hasAudio: true })
      : new NativeFlowPlayback(flow, video, source, changed);
  }
  get session() { return this.playback.session; }
  get sourceTime() { return (getScene(this.flow, this.session.sceneId).clip.inFrame + this.session.frame) / this.flow.fps; }
  get diagnostics() { return this.playback instanceof BufferedFlowPlayback ? this.playback.diagnostics : undefined; }
  setSubtitles(track: TextTrack | null, cues: VTTCue[]) {
    if (this.playback instanceof BufferedFlowPlayback) this.playback.setSubtitles(track, cues);
    else if (track) remapSubtitles(track, cues, null);
  }
  play() { this.playback.play(); }
  pause() { this.playback.pause(); }
  seekScene(id: SceneId, frame = 0, playing = false) { this.playback.seekScene(id, frame, playing); }
  seek(time: number) { this.playback.seek(time); }
  answer(answer: string) { this.playback.answer(answer); }
  branch(id: SceneId, outcome: Outcome) { this.playback.branch(id, outcome); }
  dispose() { this.playback.dispose(); }
}
