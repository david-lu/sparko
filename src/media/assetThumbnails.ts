import { openInput, sampleFrames, timelineThumbnailCount, type MediaSource, type Thumbnail } from './media';

const cache = new Map<string, Promise<Thumbnail[]>>();

/** Decode a video once for the timeline; clip boundaries only select from these frames. */
export function assetThumbnails(source: MediaSource, knownDuration?: number): Promise<Thumbnail[]> {
  const key = source.assetId ? `asset:${source.assetId}` : `url:${source.url}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const task = (async () => {
    let duration = knownDuration;
    if (duration === undefined) {
      const input = openInput(source);
      try { duration = await input.computeDuration(); }
      finally { input.dispose(); }
    }
    return sampleFrames(source, { start: 0, end: duration }, timelineThumbnailCount(duration), 240);
  })();
  cache.set(key, task);
  void task.catch(() => { if (cache.get(key) === task) cache.delete(key); });
  return task;
}

/** Choose preview images by their position in the original video, without decoding a clip. */
export function clipThumbnails(frames: Thumbnail[], start: number, end: number): Thumbnail[] {
  if (!frames.length) return [];
  const count = timelineThumbnailCount(Math.max(0, end - start));
  return Array.from({ length: count }, (_, index) => {
    const target = start + (end - start) * (index + .5) / count;
    return frames.reduce((nearest, frame) => Math.abs(frame.time - target) < Math.abs(nearest.time - target) ? frame : nearest);
  });
}
