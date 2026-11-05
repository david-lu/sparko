import { openInput, sampleFrames, timelineThumbnailCount, type MediaSource, type Thumbnail } from './media';

export type AssetThumbnail = Thumbnail & { start: number; end: number };

const cache = new Map<string, Promise<AssetThumbnail[]>>();

/** Decode a video once for the timeline; clip boundaries only select from these frames. */
export function assetThumbnails(source: MediaSource, knownDuration?: number): Promise<AssetThumbnail[]> {
  const key = source.assetId ? `asset:${source.assetId}` : `url:${source.url}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const task = (async () => {
    if (source.kind === 'image') {
      const [frame] = await sampleFrames(source, { start: 0, end: 1 }, 1, 240);
      return [{ ...frame, start: 0, end: knownDuration ?? source.duration ?? 4 }];
    }
    let duration = knownDuration;
    if (duration === undefined) {
      const input = openInput(source);
      try { duration = await input.computeDuration(); }
      finally { input.dispose(); }
    }
    const count = timelineThumbnailCount(duration), interval = duration / count;
    const frames = await sampleFrames(source, { start: 0, end: duration }, count, 240);
    return frames.map(frame => ({ ...frame, start: frame.time - interval / 2, end: frame.time + interval / 2 }));
  })();
  cache.set(key, task);
  void task.catch(() => { if (cache.get(key) === task) cache.delete(key); });
  return task;
}

/** Crop the asset's filmstrip without moving its samples away from their source timestamps. */
export function clipThumbnails(frames: AssetThumbnail[], start: number, end: number): AssetThumbnail[] {
  if (end <= start) return [];
  return frames.filter(frame => frame.end > start && frame.start < end);
}
