import { openInput, sampleFrames, timelineThumbnailCount, type MediaSource, type Thumbnail } from './media';

export type AssetThumbnail = Thumbnail & { start: number; end: number };

type CachedThumbnails = { task: Promise<AssetThumbnail[]>; bytes: number };
const cache = new Map<string, CachedThumbnails>();
export const THUMBNAIL_CACHE_LIMIT = 64;
export const THUMBNAIL_CACHE_BYTES = 32 * 1024 * 1024;
let cachedBytes = 0;
function remove(key: string) {
  cachedBytes -= cache.get(key)?.bytes ?? 0;
  cache.delete(key);
}
function trim() {
  while (cache.size > THUMBNAIL_CACHE_LIMIT || cachedBytes > THUMBNAIL_CACHE_BYTES) remove(cache.keys().next().value!);
}
/** Active consumers retain their frames; the shared cache releases other projects. */
export function releaseAssetThumbnails(keep: Set<string>) {
  for (const key of cache.keys()) if (!key.startsWith('asset:') || !keep.has(key.slice(6))) remove(key);
}

/** Decode a video once for the timeline; clip boundaries only select from these frames. */
export function assetThumbnails(source: MediaSource, knownDuration?: number): Promise<AssetThumbnail[]> {
  const key = source.assetId ? `asset:${source.assetId}` : `url:${source.url}`;
  const cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return cached.task; }
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
  const entry = { task, bytes: 0 };
  cache.set(key, entry); trim();
  void task.then(frames => {
    if (cache.get(key) !== entry) return;
    // JPEG data URLs are strings; budget conservatively for two bytes per character.
    entry.bytes = frames.reduce((sum, frame) => sum + frame.url.length * 2, 0);
    cachedBytes += entry.bytes; trim();
  }, () => { if (cache.get(key) === entry) remove(key); });
  return task;
}

/** Crop the asset's filmstrip without moving its samples away from their source timestamps. */
export function clipThumbnails(frames: AssetThumbnail[], start: number, end: number): AssetThumbnail[] {
  if (end <= start) return [];
  return frames.filter(frame => frame.end > start && frame.start < end);
}
