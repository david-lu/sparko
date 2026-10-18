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

const frames = [1, 3, 5, 7].map(time => ({ time, url: `frame:${time}` }));

describe('asset thumbnails', () => {
  beforeEach(() => { media.openInput.mockReset(); media.sampleFrames.mockReset(); });

  it('decodes the full asset once while different clips select from the cached frames', async () => {
    media.sampleFrames.mockResolvedValue(frames);
    const source = { id: 'source:split-test', assetId: 'split-test', name: 'video.mp4', url: 'blob:split-test' };
    const first = assetThumbnails(source, 8), second = assetThumbnails(source, 8);
    expect(first).toBe(second);
    expect(await first).toEqual(frames);
    expect(media.sampleFrames).toHaveBeenCalledTimes(1);
    expect(media.sampleFrames).toHaveBeenCalledWith(source, { start: 0, end: 8 }, 2, 240);
    expect(clipThumbnails(await second, 0, 4).map(frame => frame.time)).toEqual([1]);
    expect(clipThumbnails(await assetThumbnails(source, 8), 4, 8).map(frame => frame.time)).toEqual([5]);
    expect(await assetThumbnails({ ...source, url: 'blob:reopened-split-test' }, 8)).toEqual(frames);
    expect(media.sampleFrames).toHaveBeenCalledTimes(1);
  });

  it('reads an unknown asset duration once and retries a failed decode', async () => {
    const source = { id: 'generated:retry-test', name: 'result.mp4', url: 'blob:retry-test' };
    const input = { computeDuration: vi.fn().mockResolvedValue(6), dispose: vi.fn() };
    media.openInput.mockReturnValue(input);
    media.sampleFrames.mockRejectedValueOnce(new Error('Decoder unavailable')).mockResolvedValueOnce(frames);
    await expect(assetThumbnails(source)).rejects.toThrow('Decoder unavailable');
    expect(await assetThumbnails(source)).toEqual(frames);
    expect(media.sampleFrames).toHaveBeenCalledTimes(2);
    expect(input.dispose).toHaveBeenCalledTimes(2);
  });
});
