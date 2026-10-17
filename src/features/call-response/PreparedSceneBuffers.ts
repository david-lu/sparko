import { BufferTarget, Mp4OutputFormat, Output } from 'mediabunny';
import { FLOW_BUFFERING } from '../../../shared/constants';
import { renderComposition } from '../../media/CompositionRenderer';
import type { MediaInfo, MediaSource } from '../../media/media';
import { assets } from '../project/assets';
import { sceneFrames, type TimelineScene } from './model';

type Render = (scene: TimelineScene, first: number, count: number, signal: AbortSignal) => Promise<Uint8Array>;
type Entry = { key: string; scene: TimelineScene; first: number; count: number; priority: number; touched: number;
  data?: Uint8Array; running: boolean; promise: Promise<Uint8Array>; resolve: (data: Uint8Array) => void; reject: (error: unknown) => void };

/** One normalized head buffer per possible response; bounded background rendering and byte cache. */
export class PreparedSceneBuffers {
  private entries = new Map<string, Entry>();
  private operation = new AbortController();
  private active = 0;
  private sequence = 0;
  private bytes = 0;
  constructor(readonly fps: number, private render: Render, private maxBytes: number = FLOW_BUFFERING.cacheBytes) {}
  get chunkFrames() { return Math.max(1, Math.round(FLOW_BUFFERING.chunkSeconds * this.fps)); }
  private key(scene: TimelineScene, first: number) {
    return `${scene.clip.assetId}:${scene.clip.inFrame + first}:${Math.min(this.chunkFrames, sceneFrames(scene) - first)}`;
  }
  ready(scene: TimelineScene, first = 0) { return !!this.entries.get(this.key(scene, first))?.data; }
  get statistics() { return { bytes: this.bytes, active: this.active, ready: [...this.entries.values()].filter(entry => entry.data).length }; }
  get(scene: TimelineScene, first: number, priority = 0): Promise<Uint8Array> {
    if (this.operation.signal.aborted) return Promise.reject(this.operation.signal.reason);
    const key = this.key(scene, first), existing = this.entries.get(key);
    if (existing) { existing.priority = Math.min(existing.priority, priority); existing.touched = ++this.sequence; return existing.promise; }
    let resolve!: Entry['resolve'], reject!: Entry['reject'];
    const promise = new Promise<Uint8Array>((yes, no) => { resolve = yes; reject = no; });
    const entry: Entry = { key, scene, first, count: Math.min(this.chunkFrames, sceneFrames(scene) - first), priority, touched: ++this.sequence, promise, resolve, reject, running: false };
    this.entries.set(key, entry); this.pump(); return promise;
  }
  private pump() {
    if (this.operation.signal.aborted) return;
    while (this.active < FLOW_BUFFERING.parallelRenders) {
      const entry = [...this.entries.values()].filter(entry => !entry.running && !entry.data).sort((a, b) => a.priority - b.priority || a.touched - b.touched)[0];
      if (!entry) return;
      entry.running = true; this.active++;
      void this.render(entry.scene, entry.first, entry.count, this.operation.signal).then(data => {
        this.operation.signal.throwIfAborted();
        entry.data = data; this.bytes += data.byteLength; entry.resolve(data);
        for (const candidate of [...this.entries.values()].filter(item => item.data).sort((a, b) => a.touched - b.touched)) {
          if (this.bytes <= this.maxBytes) break;
          this.entries.delete(candidate.key); this.bytes -= candidate.data!.byteLength;
        }
      }).catch(error => { this.entries.delete(entry.key); entry.reject(error); }).finally(() => { this.active--; this.pump(); });
    }
  }
  dispose() {
    this.operation.abort();
    for (const entry of this.entries.values()) if (!entry.data) entry.reject(this.operation.signal.reason);
    this.entries.clear(); this.bytes = 0;
  }
}

export function sceneBufferRenderer(source: MediaSource, info: MediaInfo, fps: number): Render {
  return async (scene, first, count, signal) => {
    const url = scene.clip.assetId === source.assetId ? source.url : assets.url(scene.clip.assetId);
    if (!url) throw new Error(`The media for ${scene.label} is not available. Reopen the project.`);
    const media = scene.clip.assetId === source.assetId ? source : { id: scene.clip.assetId, name: scene.label, url };
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: .5 }) });
    await renderComposition({ info, fps, segments: [{ id: scene.id, kind: 'source', label: scene.label, source: media,
      sourceStart: (scene.clip.inFrame + first) / fps, startFrame: 0, endFrame: count }], crossfade: false }, output,
    { start: 0, end: count / fps, signal, preview: true });
    if (!output.target.buffer) throw new Error(`No playback buffer was produced for ${scene.label}.`);
    return new Uint8Array(output.target.buffer);
  };
}
