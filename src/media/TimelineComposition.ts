import { playableResult, type Interstitial } from '../../shared/interstitials';
import type { MediaInfo, MediaSource } from './media';
import { assets } from '../features/project/assets';
import { TIMELINE_FPS } from '../../shared/constants';

export type TimelineSegment = {
  id: string; kind: 'source' | 'interstitial'; label: string; source: MediaSource;
  sourceStart: number; startFrame: number; endFrame: number;
  /** Repeat one boundary frame, with silent audio, for a generation reference. */
  still?: boolean;
  muted?: boolean;
};

/** Immutable 24 fps edit list. Original assets are sampled without modifying their files. */
export class TimelineComposition {
  readonly segments: TimelineSegment[] = [];
  readonly fps: number;
  readonly duration: number;
  readonly hasInsertions: boolean;
  readonly sourceDuration: number;
  readonly crossfade: boolean;
  constructor(readonly source: MediaSource, readonly info: MediaInfo, items: Interstitial[], options: { crossfade?: boolean } = {}) {
    this.crossfade = options.crossfade ?? true;
    this.fps = TIMELINE_FPS;
    let cursor = 0, sourceFrame = 0;
    const total = Math.max(1, Math.round(info.duration * this.fps));
    this.sourceDuration = total / this.fps;
    const ready = items.filter(item => !item.groupId && item.kind !== 'call-response' && playableResult(item) && item.time <= Math.max(info.duration, this.sourceDuration)).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
    const addSource = (end: number) => {
      if (end > sourceFrame) {
        this.segments.push({ id: `source:${sourceFrame}`, kind: 'source', label: source.name, source, sourceStart: sourceFrame / this.fps, startFrame: cursor, endFrame: cursor + end - sourceFrame });
        cursor += end - sourceFrame;
      }
      sourceFrame = end;
    };
    for (const item of ready) {
      addSource(Math.max(sourceFrame, Math.min(total, Math.round(item.time * this.fps))));
      const result = playableResult(item)!;
      const frames = Math.max(1, Math.round(result.duration * this.fps));
      this.segments.push({ id: item.id, kind: 'interstitial', label: item.label,
        source: { id: item.id, name: item.label, url: result.assetId ? assets.url(result.assetId) || result.url : result.url }, sourceStart: result.start, startFrame: cursor, endFrame: cursor + frames });
      cursor += frames;
    }
    addSource(total);
    this.duration = cursor / this.fps;
    this.hasInsertions = ready.length > 0;
  }
  at(time: number) {
    const frame = Math.max(0, Math.min(Math.round(this.duration * this.fps) - 1, Math.floor(time * this.fps + 1e-6)));
    return this.segments.find(segment => frame < segment.endFrame)!;
  }
  sourceTime(time: number) {
    const segment = this.at(time);
    if (!segment) return 0;
    if (segment.kind === 'source') return segment.sourceStart + Math.max(0, Math.min(time, this.duration) - segment.startFrame / this.fps);
    const next = this.segments.find(part => part.kind === 'source' && part.startFrame >= segment.endFrame);
    return next?.sourceStart ?? this.sourceDuration;
  }
  timelineTime(sourceTime: number) {
    const frame = Math.round(Math.max(0, Math.min(this.sourceDuration, sourceTime)) * this.fps);
    let inserted = 0;
    for (const segment of this.segments) {
      if (segment.kind === 'interstitial' && segment.startFrame - inserted < frame) inserted += segment.endFrame - segment.startFrame;
    }
    return (frame + inserted) / this.fps;
  }
  itemTime(item: Interstitial) {
    const segment = this.segments.find(part => part.id === item.id);
    return segment ? segment.startFrame / this.fps : this.timelineTime(item.time);
  }
}
