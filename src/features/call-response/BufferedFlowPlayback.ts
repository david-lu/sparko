import { FLOW_BUFFERING } from '../../../shared/constants';
import { COMPOSITION_MIME } from '../../media/CompositionRenderer';
import type { MediaInfo, MediaSource as MediaAssetSource } from '../../media/media';
import { FlowBufferPlan } from './FlowBufferPlan';
import { PreparedSceneBuffers, sceneBufferRenderer } from './PreparedSceneBuffers';
import { remapSubtitles } from '../player/subtitles';
import { answerSession, branchSession, flowLayout, getScene, previewScene, sceneFrames, startSession,
  type CallResponseFlow, type Outcome, type PlaybackSession, type SceneId } from './model';

/** One continuous media stream, with a separate prepared head for each possible response. */
export class BufferedFlowPlayback {
  session: PlaybackSession;
  private cache: PreparedSceneBuffers;
  private plan: FlowBufferPlan;
  private run = new AbortController();
  private lifetime = new AbortController();
  private media?: MediaSource;
  private buffer?: SourceBuffer;
  private url?: string;
  private animation = 0;
  private wanted = false;
  private buffering = true;
  private initializing = true;
  private disposed = false;
  private pumping = false;
  private revision = 0;
  private appended = 0;
  private mutations: Promise<void> = Promise.resolve();
  private warmed = new Set<string>();
  private subtitles?: { track: TextTrack; cues: VTTCue[] };

  constructor(readonly flow: CallResponseFlow, private video: HTMLVideoElement, private source: MediaAssetSource,
    private changed: (session: PlaybackSession, buffering: boolean, error?: string) => void, info: MediaInfo) {
    this.session = startSession(flow); this.plan = new FlowBufferPlan(flow, this.session);
    this.cache = new PreparedSceneBuffers(flow.fps, sceneBufferRenderer(source, info, flow.fps));
    const signal = this.lifetime.signal;
    video.loop = false;
    video.addEventListener('waiting', () => { if (!this.session.finished) { this.buffering = true; this.emit(); } }, { signal });
    video.addEventListener('canplay', () => {
      if (video.currentSrc !== this.url) return;
      this.updateSubtitles();
      this.initializing = false; this.buffering = false; this.emit();
      if (this.wanted) this.playVideo();
    }, { signal });
    video.addEventListener('playing', () => { this.buffering = false; this.emit(); }, { signal });
    video.addEventListener('error', () => { if (video.error && video.currentSrc === this.url) this.fail(new Error('Unable to decode the prepared call-response stream.')); }, { signal });
    video.addEventListener('play', () => { if (!this.initializing) { this.wanted = true; this.sync(); } }, { signal });
    video.addEventListener('pause', () => { if (!this.initializing && !this.buffering && !video.ended) { this.wanted = false; this.sync(); } }, { signal });
    video.addEventListener('timeupdate', () => { this.sync(); this.pump(); }, { signal });
    video.addEventListener('ended', () => this.sync(), { signal });
    const tick = () => { if (this.disposed) return; this.sync(); this.pump(); this.animation = requestAnimationFrame(tick); };
    this.animation = requestAnimationFrame(tick); this.restart();
  }
  get diagnostics() {
    return { ...this.cache.statistics, preparedScenes: this.flow.scenes.filter(scene => this.cache.ready(scene)).map(scene => scene.id),
      aheadSeconds: Math.max(0, this.appended / this.flow.fps - this.video.currentTime), visits: this.plan.visits.length };
  }
  private emit(error?: string) { if (!this.disposed) this.changed(this.session, this.buffering, error); }
  setSubtitles(track: TextTrack | null, cues: VTTCue[]) {
    this.subtitles = track ? { track, cues } : undefined; this.updateSubtitles();
  }
  private updateSubtitles() {
    if (!this.subtitles) return;
    remapSubtitles(this.subtitles.track, this.subtitles.cues, { hasInsertions: true, fps: this.flow.fps,
      segments: this.plan.visits.map(visit => {
        const scene = getScene(this.flow, visit.state.sceneId);
        return { id: `${scene.id}:${visit.startFrame}`, kind: scene.clip.assetId === this.source.assetId ? 'source' as const : 'interstitial' as const,
          label: scene.label, source: this.source, sourceStart: (scene.clip.inFrame + visit.state.frame) / this.flow.fps,
          startFrame: visit.startFrame, endFrame: visit.endFrame };
      }) });
  }
  private clock() { return Math.max(0, Math.floor(this.video.currentTime * this.flow.fps + 1e-4)); }
  private sync() {
    if (this.disposed || this.initializing || this.video.seeking || this.session.finished) return;
    const next = this.plan.at(this.clock(), this.wanted);
    if (next.sceneId === this.session.sceneId && next.frame === this.session.frame && next.visit === this.session.visit && next.playing === this.session.playing) return;
    this.session = next;
    if (next.finished) { this.wanted = false; this.video.pause(); }
    this.emit();
  }
  private playVideo() {
    const signal = this.run.signal;
    void this.video.play().catch(error => {
      if (!signal.aborted && this.wanted && (error as Error)?.name !== 'AbortError') {
        this.wanted = false; this.session = { ...this.session, playing: false }; this.emit('Press Play to start this scene.');
      }
    });
  }
  private restart() {
    this.run.abort(); this.run = new AbortController();
    const signal = this.run.signal;
    this.revision++; this.initializing = true; this.buffering = true;
    this.video.pause(); this.buffer = undefined; this.appended = 0; this.mutations = Promise.resolve(); this.pumping = false;
    if (this.url) URL.revokeObjectURL(this.url);
    this.plan = new FlowBufferPlan(this.flow, this.session);
    this.updateSubtitles();
    const media = new MediaSource(); this.media = media;
    this.url = URL.createObjectURL(media); this.video.src = this.url; this.video.preload = 'auto'; this.video.load();
    media.addEventListener('sourceopen', () => {
      if (signal.aborted) return;
      try { this.buffer = media.addSourceBuffer(COMPOSITION_MIME); media.duration = Infinity; this.pump(); }
      catch (error) { this.fail(error); }
    }, { once: true, signal });
    this.emit();
  }
  private mutate(action: () => Promise<void> | void) {
    const task = this.mutations.then(action); this.mutations = task.catch(() => undefined); return task;
  }
  private update(buffer: SourceBuffer, action: () => void, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      signal.throwIfAborted();
      const cleanup = () => { buffer.removeEventListener('updateend', done); buffer.removeEventListener('error', fail); signal.removeEventListener('abort', abort); };
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('Unable to append a call-response playback buffer.')); };
      const abort = () => { cleanup(); reject(signal.reason); };
      buffer.addEventListener('updateend', done, { once: true }); buffer.addEventListener('error', fail, { once: true }); signal.addEventListener('abort', abort, { once: true });
      try { action(); } catch (error) { cleanup(); reject(error); }
    });
  }
  private warm(sceneId: SceneId, depth = 0, visited = new Set<string>()) {
    if (depth > 2 || visited.has(sceneId)) return;
    visited.add(sceneId);
    const scene = getScene(this.flow, sceneId), key = `${scene.clip.assetId}:${scene.clip.inFrame}:${scene.clip.outFrame}`;
    if (!this.warmed.has(key)) { this.warmed.add(key); void this.cache.get(scene, 0, 10).catch(() => undefined); }
    for (const edge of this.flow.edges.filter(edge => edge.from === sceneId)) this.warm(edge.to, depth + 1, visited);
  }
  private pump() {
    if (this.pumping || this.disposed || !this.buffer || this.run.signal.aborted || this.media?.readyState !== 'open') return;
    this.pumping = true;
    const signal = this.run.signal, buffer = this.buffer, media = this.media;
    void (async () => {
      while (!signal.aborted && this.appended < this.clock() + FLOW_BUFFERING.aheadSeconds * this.flow.fps) {
        if (this.appended >= this.plan.visits.at(-1)!.endFrame) {
          const previous = this.plan.visits.at(-1)!;
          // Keep alternatives in the preparation cache until the loop's decision point.
          // Once a loop is submitted to MSE, its decoded frames must remain authoritative.
          const previousScene = getScene(this.flow, previous.state.sceneId);
          const leadFrames = Math.min(sceneFrames(previousScene), Math.ceil(FLOW_BUFFERING.decisionLeadSeconds * this.flow.fps));
          if (previousScene.clip.kind === 'idle' && !previous.state.outcome && this.clock() < previous.endFrame - leadFrames) break;
          if (!this.plan.append()) {
            await this.mutate(() => { if (!signal.aborted && media.readyState === 'open') media.endOfStream(); });
            break;
          }
          this.updateSubtitles();
        }
        const revision = this.revision, at = this.appended, visit = this.plan.visitAt(at);
        const scene = getScene(this.flow, visit.state.sceneId), first = visit.state.frame + at - visit.startFrame;
        const count = Math.min(this.cache.chunkFrames, visit.endFrame - at);
        const pending = this.cache.get(scene, first); this.warm(scene.id);
        const data = await pending;
        if (signal.aborted) return;
        if (revision !== this.revision) continue;
        await this.mutate(async () => {
          signal.throwIfAborted();
          if (revision !== this.revision) return;
          buffer.timestampOffset = at / this.flow.fps;
          await this.update(buffer, () => buffer.appendBuffer(Uint8Array.from(data)), signal);
          this.appended = at + count;
          const removeTo = this.video.currentTime - FLOW_BUFFERING.retainSeconds;
          if (removeTo > 1 && buffer.buffered.length && buffer.buffered.start(0) < removeTo - 1) await this.update(buffer, () => buffer.remove(0, removeTo), signal);
          this.plan.prune(Math.floor(removeTo * this.flow.fps));
          this.updateSubtitles();
        });
      }
    })().catch(error => { if (!signal.aborted) this.fail(error); }).finally(() => { if (this.run.signal === signal) this.pumping = false; });
  }
  private choose(state: PlaybackSession) {
    if (state === this.session) return;
    this.session = state;
    const cut = this.plan.choose(this.clock(), state, this.appended);
    this.updateSubtitles();
    this.revision++;
    const signal = this.run.signal, buffer = this.buffer;
    void this.mutate(async () => {
      signal.throwIfAborted();
      if (buffer?.buffered.length && buffer.buffered.end(buffer.buffered.length - 1) > cut / this.flow.fps) await this.update(buffer, () => buffer.remove(cut / this.flow.fps, Infinity), signal);
      this.appended = Math.min(this.appended, cut);
    }).then(() => this.pump()).catch(error => { if (!signal.aborted) this.fail(error); });
    this.emit();
  }
  private fail(error: unknown) {
    if (this.disposed) return;
    this.run.abort(); this.wanted = false; this.buffering = false; this.initializing = true;
    this.video.pause(); this.session = { ...this.session, playing: false };
    this.emit(error instanceof Error ? error.message : 'Call-response playback failed.');
  }
  play() {
    this.wanted = true;
    if (this.session.finished) { this.session = startSession(this.flow, true); this.restart(); return; }
    this.session = { ...this.session, playing: true };
    if (this.run.signal.aborted) this.restart();
    this.emit(); if (!this.buffering) this.playVideo();
  }
  pause() { this.wanted = false; this.session = { ...this.session, playing: false }; this.video.pause(); this.emit(); }
  seekScene(id: SceneId, frame = 0, playing = false) {
    this.wanted = playing;
    this.session = { ...previewScene(this.flow, id), frame: Math.max(0, Math.min(sceneFrames(getScene(this.flow, id)) - 1, Math.round(frame))), playing };
    this.restart();
  }
  seek(time: number) {
    const layout = flowLayout(this.flow), frame = Math.max(0, time * this.flow.fps);
    const answer = this.flow.interaction.answers.find(answer => answer.id === this.session.outcome || answer.sceneId === this.session.sceneId);
    const path = ['intro', 'call', 'wait', answer?.sceneId ?? this.flow.interaction.answers[0].sceneId, 'continue'];
    const id = [...path].reverse().find(id => frame >= layout.starts[id]) ?? 'intro';
    this.seekScene(id, frame - layout.starts[id], this.wanted);
  }
  answer(answer: string) { this.sync(); this.choose(answerSession(this.flow, this.session, answer)); }
  branch(id: SceneId, outcome: Outcome) {
    if (getScene(this.flow, id).clip.kind !== 'idle') return;
    this.sync();
    if (this.session.sceneId !== id || this.session.outcome || this.session.finished) this.seekScene(id);
    this.choose(branchSession(this.flow, this.session, outcome)); this.play();
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.animation); this.lifetime.abort(); this.run.abort(); this.cache.dispose();
    if (this.video.src === this.url) { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); }
    if (this.url) URL.revokeObjectURL(this.url);
  }
}
