import { inspectMedia, type MediaInfo, type MediaSource } from '../../media/media';
import { TimelineComposition } from '../../media/TimelineComposition';
import { CanvasTimelinePlayback } from './CanvasTimelinePlayback';
import { remapSubtitles } from './subtitles';
import { INTERSTITIAL_CROSSFADE_FRAMES, TIMELINE_FPS } from '../../../shared/constants';
import { FlowPlayback } from '../call-response/FlowPlayback';
import { flowLayout, type CallResponseFlow, type Outcome, type PlaybackSession, type SceneId } from '../call-response/model';

export type PlayerState = {
  time: number; duration: number; playing: boolean; buffering: boolean;
  volume: number; muted: boolean; speed: number; loop: boolean; error: string | null;
  buffered: { start: number; end: number }[];
  flow: PlaybackSession | null;
};
const initialState = (): PlayerState => ({ time: 0, duration: 0, playing: false, buffering: false,
  volume: 1, muted: false, speed: 1, loop: false, error: null, buffered: [], flow: null });

/** Owns transport, media events, segment playback, and element lifetime. No React dependency. */
export class VideoPlayerController {
  private element: HTMLVideoElement | null = null;
  private source: MediaSource | null = null;
  private state = initialState();
  private listeners = new Set<() => void>();
  private previewEnd: number | null = null;
  private composition: TimelineComposition | null = null;
  private timeline: CanvasTimelinePlayback | null = null;
  private pendingSeek: number | null = null;
  private wantsPlayback = false;
  private sourceLoad: AbortController | null = null;
  private flowPlayback: FlowPlayback | null = null;
  private subtitles: { track: TextTrack | null; cues: VTTCue[]; enabled: boolean } = { track: null, cues: [], enabled: true };

  getSnapshot = (): PlayerState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  get video(): HTMLVideoElement | null { return this.timeline?.video ?? this.flowPlayback?.video ?? this.element; }
  get subtitleVideo(): HTMLVideoElement | null { return this.element; }
  get canvas() { return this.timeline?.canvas ?? this.flowPlayback?.canvas; }
  async requestPictureInPicture() { await (this.timeline ?? this.flowPlayback)?.requestPictureInPicture(); }
  private update(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }

  attach = (element: HTMLVideoElement | null) => {
    if (element === this.element) return;
    this.element?.pause();
    this.element = element;
    if (!element) { this.flowPlayback?.dispose(); this.flowPlayback = null; this.sourceLoad?.abort(); this.timeline?.dispose(); this.timeline = null; this.pendingSeek = null; this.wantsPlayback = false; return; }
    this.applySettings();
    if (this.composition) this.startTimeline(this.state.time);
    else if (this.source) this.startSource(this.state.time);
    else { element.removeAttribute('src'); element.load(); }
  };

  load(source: MediaSource) {
    this.flowPlayback?.dispose(); this.flowPlayback = null;
    this.sourceLoad?.abort(); this.timeline?.dispose(); this.timeline = null; this.composition = null; this.pendingSeek = null; this.wantsPlayback = false;
    this.source = source; this.previewEnd = null;
    this.element?.pause();
    this.update({ time: 0, duration: 0, playing: false, buffering: true, error: null, buffered: [], flow: null });
    if (this.element) this.startSource(0);
  }
  private applySettings() {
    if (this.timeline) { this.timeline.setSettings(this.state, this.state.loop); return; }
    if (this.flowPlayback) { this.flowPlayback.setSettings(this.state); return; }
    if (!this.element) return;
    this.element.volume = this.state.volume; this.element.muted = this.state.muted;
    this.element.playbackRate = this.state.speed; this.element.loop = this.state.loop;
  }
  setComposition(composition: TimelineComposition) {
    this.flowPlayback?.dispose(); this.flowPlayback = null;
    if (this.state.flow) this.update({ flow: null });
    if (this.composition === composition) return;
    const wasPlaying = this.wantsPlayback || this.state.playing;
    const sourceTime = this.composition?.sourceTime(this.state.time) ?? this.state.time;
    const previous = this.composition;
    const sameEdit = previous && (previous.crossfade !== composition.crossfade || previous.crossfadeFrames !== composition.crossfadeFrames || previous.matchFraming !== composition.matchFraming) && previous.fps === composition.fps && previous.duration === composition.duration
      && previous.segments.length === composition.segments.length && previous.segments.every((segment, index) => {
        const next = composition.segments[index];
        return segment.id === next.id && segment.source.url === next.source.url && segment.sourceStart === next.sourceStart && segment.startFrame === next.startFrame && segment.endFrame === next.endFrame && segment.still === next.still;
      });
    this.composition = composition;
    this.sourceLoad?.abort(); this.timeline?.dispose(); this.timeline = null; this.pendingSeek = null;
    this.wantsPlayback = wasPlaying;
    const time = sameEdit ? this.state.time : composition.timelineTime(sourceTime);
    this.update({ time, duration: composition.duration, buffered: [], error: null });
    if (!this.element) return;
    this.startTimeline(time);
  }
  setFlow(flow: CallResponseFlow, info?: MediaInfo, matchFraming = false, crossfade = true, crossfadeFrames = INTERSTITIAL_CROSSFADE_FRAMES) {
    if (!this.element || !this.source) return;
    // Overlay text, answer matching, and editor labels can change without
    // replacing the media canvas or moving the playhead. Scene/edge structure
    // and clip media still determine when playback must be rebuilt.
    const mediaLayout = (value: CallResponseFlow) => JSON.stringify(value,
      (key, part) => ['interstitial', 'loopAudio', 'interaction', 'label', 'dialogue'].includes(key) ? undefined : part);
    if (this.flowPlayback && (flow.storyGraph && this.flowPlayback.flow.storyGraph || this.flowPlayback.flow === flow || mediaLayout(this.flowPlayback.flow) === mediaLayout(flow))) {
      this.flowPlayback.setFlow(flow);
      this.flowPlayback.setMatchFraming(matchFraming); this.flowPlayback.setCrossfade(crossfade, crossfadeFrames); return;
    }
    this.flowPlayback?.dispose(); this.flowPlayback = null;
    this.sourceLoad?.abort(); this.timeline?.dispose(); this.timeline = null;
    this.composition = null; this.pendingSeek = null; this.wantsPlayback = false;
    this.element.pause();
    this.applySettings();
    const layout = flowLayout(flow);
    this.flowPlayback = new FlowPlayback(flow, this.element, this.source, (session, buffering, error) => {
      const currentLayout=this.flowPlayback?.flow.storyGraph?flowLayout(this.flowPlayback.flow):layout;
      const time = ((currentLayout.starts[session.sceneId]??0) + session.frame) / flow.fps;
      this.update({ flow: session, playing: session.playing, buffering, error: error ?? null,
        buffered: [{ start: time, end: time + (this.flowPlayback?.bufferedAhead ?? 0) }], time, duration: currentLayout.totalFrames / flow.fps });
    }, info, matchFraming, crossfade, crossfadeFrames);
    this.applySettings(); this.setSubtitles(this.subtitles.track, this.subtitles.cues, this.subtitles.enabled);
  }
  seekFlowScene(id: SceneId, frame = 0) { this.flowPlayback?.seekScene(id, frame); }
  setSubtitles(track: TextTrack | null, cues: VTTCue[], enabled = true) {
    this.subtitles = { track, cues, enabled };
    if (this.flowPlayback) this.flowPlayback.setSubtitles(track, cues, enabled);
    else if (this.timeline) this.timeline.setSubtitles(track, cues, enabled);
    else if (track) { remapSubtitles(track, cues, null); track.mode = enabled ? 'showing' : 'hidden'; }
  }
  answerFlow(answer: string) { this.flowPlayback?.answer(answer); }
  branchFlow(id: SceneId, outcome: Outcome) { this.flowPlayback?.branch(id, outcome); }
  /** Source-only playback uses the same canvas and clock as compositions. */
  private startSource(time: number) {
    if (!this.element || !this.source) return;
    this.sourceLoad?.abort();
    const operation = new AbortController(); this.sourceLoad = operation;
    this.pendingSeek = time; this.previewEnd = null;
    this.update({ time, playing: false, buffering: true, error: null, buffered: [] });
    const source = this.source;
    void inspectMedia(source).then(info => {
      if (operation.signal.aborted) return;
      this.composition = new TimelineComposition(source, info, []);
      this.update({ duration: this.composition.duration }); this.startTimeline(time);
    }).catch(error => { if (!operation.signal.aborted) this.update({ buffering: false, error: error instanceof Error ? error.message : 'Unable to open this video.' }); });
  }
  private startTimeline(time: number) {
    if (!this.element || !this.composition) return;
    this.sourceLoad?.abort();
    this.pendingSeek = null; this.previewEnd = null;
    this.element.pause();
    this.applySettings();
    this.update({ time, playing: false, buffering: true, error: null, buffered: [] });
    this.timeline = new CanvasTimelinePlayback(this.composition, this.element, (time, playing, buffering, error) => {
      this.wantsPlayback = playing;
      this.update({ time, playing, buffering, error: error ?? null,
        buffered: [{ start: time, end: Math.min(this.composition!.duration, time + (this.timeline?.bufferedAhead ?? 0)) }] });
      if (this.previewEnd !== null && time >= this.previewEnd) { const end = this.previewEnd; this.previewEnd = null; this.pause(); this.timeline?.seek(end); }
    });
    const autoplay = this.wantsPlayback;
    this.timeline.seek(time); this.applySettings(); this.setSubtitles(this.subtitles.track, this.subtitles.cues, this.subtitles.enabled);
    if (autoplay) this.timeline.play();
  }
  getSourceTime() { if (this.flowPlayback) return this.flowPlayback.sourceTime; const time = this.timeline ? this.state.time : this.pendingSeek ?? this.element?.currentTime ?? this.state.time; return this.composition?.sourceTime(time) ?? time; }
  getSourceDuration() { return this.composition?.info.duration ?? this.state.duration; }
  async play() {
    if (this.flowPlayback) { this.flowPlayback.play(); return; }
    if (this.timeline) { this.timeline.play(); return; }
    if (!this.element) return;
    this.wantsPlayback = true;
  }
  pause() { if (this.flowPlayback) { this.flowPlayback.pause(); return; } if (this.timeline) { this.timeline.pause(); return; } this.wantsPlayback = false; this.element?.pause(); }
  togglePlayback() { if (this.flowPlayback || this.timeline) { if (this.state.playing) this.pause(); else void this.play(); return; } if (this.pendingSeek !== null && this.wantsPlayback || this.element && !this.element.paused) this.pause(); else void this.play(); }
  seek(time: number) {
    if (!this.element || !Number.isFinite(time) || !this.state.duration) return;
    if (this.flowPlayback) { this.flowPlayback.seek(time); return; }
    this.previewEnd = null;
    const fps = this.composition?.fps ?? TIMELINE_FPS;
    const target = Math.max(0, Math.min(this.state.duration, Math.round(time * fps) / fps));
    if (this.timeline) { this.timeline.seek(target); return; }
    if (this.pendingSeek !== null) { this.startSource(target); return; }
    this.update({ time: target });
  }
  skip(seconds: number) { this.seek(this.state.time + seconds); }
  stepFrame(direction: -1 | 1) {
    this.pause();
    const fps = this.composition?.fps ?? TIMELINE_FPS;
    // HTMLMediaElement rounds timestamps to microseconds; account for that when
    // stepping back from a fractional 24 fps boundary such as 25 / 24 seconds.
    this.seek((Math.floor((this.state.time + 1e-6) * fps) + direction) / fps);
  }
  setVolume(volume: number) {
    this.update({ volume: Math.max(0, Math.min(1, volume)), muted: volume === 0 }); this.applySettings();
  }
  toggleMute() { this.update({ muted: !this.state.muted }); this.applySettings(); }
  setSpeed(speed: number) { if (speed > 0 && speed <= 4) { this.update({ speed }); this.applySettings(); } }
  setLoop(loop: boolean) { this.update({ loop }); this.applySettings(); }
  preview(start: number, end: number) { this.seek(start); this.previewEnd = end; void this.play(); }
  previewSource(start: number, end: number) { this.preview(this.composition?.timelineTime(start) ?? start, this.composition?.timelineTime(end) ?? end); }
  clearError() { this.update({ error: null }); }
  close() {
    this.attach(null);
    this.timeline = null;
    this.sourceLoad = null;
    this.source = null;
    this.composition = null;
    this.previewEnd = null;
    this.update({ time: 0, duration: 0, playing: false, buffering: false, error: null, buffered: [], flow: null });
  }
  dispose() {
    this.flowPlayback?.dispose(); this.flowPlayback = null;
    this.timeline?.dispose(); this.timeline = null;
    this.sourceLoad?.abort(); this.sourceLoad = null;
    this.attach(null); this.listeners.clear(); this.source = null;
  }
}
