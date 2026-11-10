import { expect, test, openVideo } from './fixtures';

test.beforeEach(async ({ page }) => { await openVideo(page); });

test('Mediabunny exports a non-keyframe MP4 cut with video and audio', async ({ page }) => {
  const result = await page.evaluate(async () => {
    // Import through Vite to exercise the public code-only API in a real WebCodecs browser.
    const { MediaEngine } = await import('/src/media/MediaEngine.ts' as string);
    const { Input, BlobSource, ALL_FORMATS } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const engine = new MediaEngine({ id: 'test', name: 'episode_mock.mp4', url: '/media/episode_mock.mp4' });
    try {
      const blob = await engine.exportMp4({ start: 1.25, end: 3.75 });
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      try {
        const video = await input.getPrimaryVideoTrack(); const audio = await input.getPrimaryAudioTrack();
        const frames = await engine.frames({ start: 1.25, end: 3.75 }, 3);
        return { size: blob.size, mime: blob.type, duration: await input.computeDuration(),
          videoDuration: await video?.computeDuration(), sampleRate: await audio?.getSampleRate(), videoCodec: await video?.getCodec(), audioCodec: await audio?.getCodec(),
          frames: frames.length, firstFrameTime: await video?.getFirstTimestamp() };
      } finally { input.dispose(); }
    } finally { engine.dispose(); }
  });
  expect(result.mime).toBe('video/mp4'); expect(result.size).toBeGreaterThan(1000);
  expect(result.videoCodec).toBe('avc'); expect(result.audioCodec).toBe('aac');
  expect(result.videoDuration).toBeCloseTo(2.5, 2); expect(Math.abs(result.duration - 2.5)).toBeLessThan(4096 / result.sampleRate!); expect(result.firstFrameTime).toBeCloseTo(0, 2); expect(result.frames).toBe(3);
});
