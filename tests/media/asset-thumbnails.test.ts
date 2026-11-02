import { beforeEach, describe, expect, it, vi } from 'vitest';

const media = vi.hoisted(() => ({
  openInput: vi.fn(),
  sampleFrames: vi.fn(),
}));
vi.mock('../../src/media/media', () => ({
  ...media,
  timelineThumbnailCount: (duration: number) => Math.max(1, Math.min(120, Math.ceil(duration / 5))),
}));

import { assetThumbnails, clipThumbnails } from '../../src/media/assetThumbnails';

const frames = [2, 6, 10, 14].map(time => ({ time, url: `frame:${time}` }));
const assetFrames = frames.map(frame => ({ ...frame, start: frame.time - 2, end: frame.time + 2 }));

describe('asset thumbnails', () => {
  beforeEach(() => { media.openInput.mockReset(); media.sampleFrames.mockReset(); });

  it('decodes the full asset once while different clips select from the cached frames', async () => {
    media.sampleFrames.mockResolvedValue(frames);
    const source = { id: 'source:split-test', assetId: 'split-test', name: 'video.mp4', url: 'blob:split-test' };
    const first = assetThumbnails(source, 16), second = assetThumbnails(source, 16);
    expect(first).toBe(second);
    expect(await first).toEqual(assetFrames);
    expect(media.sampleFrames).toHaveBeenCalledTimes(1);
    expect(media.sampleFrames).toHaveBeenCalledWith(source, { start: 0, end: 16 }, 4, 240);
    expect(clipThumbnails(await second, 0, 8).map(frame => frame.time)).toEqual([2, 6]);
    expect(clipThumbnails(await assetThumbnails(source, 16), 8, 16).map(frame => frame.time)).toEqual([10, 14]);
    expect(await assetThumbnails({ ...source, url: 'blob:reopened-split-test' }, 16)).toEqual(assetFrames);
    expect(media.sampleFrames).toHaveBeenCalledTimes(1);
  });

  it('reads an unknown asset duration once and retries a failed decode', async () => {
    const source = { id: 'generated:retry-test', name: 'result.mp4', url: 'blob:retry-test' };
    const input = { computeDuration: vi.fn().mockResolvedValue(16), dispose: vi.fn() };
    media.openInput.mockReturnValue(input);
    media.sampleFrames.mockRejectedValueOnce(new Error('Decoder unavailable')).mockResolvedValueOnce(frames);
    await expect(assetThumbnails(source)).rejects.toThrow('Decoder unavailable');
    expect(await assetThumbnails(source)).toEqual(assetFrames);
    expect(media.sampleFrames).toHaveBeenCalledTimes(2);
    expect(input.dispose).toHaveBeenCalledTimes(2);
  });

  it('keeps source intervals intact when trimming or splitting through a thumbnail', () => {
    expect(clipThumbnails(assetFrames, 3, 13)).toEqual(assetFrames);
    expect(clipThumbnails(assetFrames, 0, 5)).toEqual(assetFrames.slice(0, 2));
    expect(clipThumbnails(assetFrames, 5, 16)).toEqual(assetFrames.slice(1));
    expect(clipThumbnails(assetFrames, 5, 7)).toEqual([assetFrames[1]]);
    expect(clipThumbnails(assetFrames, 6, 6)).toEqual([]);
    expect(clipThumbnails([], 0, 5)).toEqual([]);
  });

  it('preserves time positions when a sampled frame cannot be decoded', async () => {
    media.sampleFrames.mockResolvedValue([frames[0], frames[2], frames[3]]);
    const result = await assetThumbnails({ id: 'missing-frame', name: 'video.mp4', url: 'blob:missing-frame' }, 16);
    expect(result).toEqual([assetFrames[0], assetFrames[2], assetFrames[3]]);
  });
});
