import { expect, test, openVideo, seekSource, addDraft, saveAndReopen } from './fixtures';

test.beforeEach(async ({ page }) => { await openVideo(page); });

test('canvas playback, settings and draft persistence', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.locator('.video-stage').hover();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number(await page.locator('.story-filmstrip').getAttribute('aria-valuenow'))).toBeGreaterThan(.1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await seekSource(page, 1.5);
  await page.locator('.video-stage').hover();
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('1.5');
  await expect(page.getByRole('combobox', { name: 'Playback speed' })).toHaveValue('1.5');
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toBeVisible();
  await addDraft(page, 'Opening moment');
  await page.getByLabel('Video prompt').fill('Remember the opening');
  await saveAndReopen(page);
  await page.locator('.story-clip.type-simple .story-clip-title').click();
  await expect(page.getByLabel('Video prompt')).toHaveValue('Remember the opening');
  await page.getByRole('button', { name: 'Delete selected clips' }).click();
  await expect(page.locator('.story-clip')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('keyboard seeking, captions and mobile layout', async ({ page }) => {
  await seekSource(page, 1);
  await page.locator('.story-filmstrip').press('ArrowRight');
  await expect(page.locator('.story-filmstrip')).toHaveAttribute('aria-valuenow', String(25 / 24));
  await page.getByLabel('Choose subtitle file').setInputFiles({ name: 'test.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00.000 --> 00:03.000\nTest subtitle\n') });
  await expect(page.locator('.playback-captions')).toContainText('Test subtitle');
  await page.locator('.video-stage').hover(); await page.getByRole('button', { name: 'Toggle captions' }).click();
  await expect(page.locator('.playback-captions')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

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
