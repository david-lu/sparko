import { expect, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.duration)).toBeGreaterThan(0);
});

test('default video, playback, seeking, settings and persistent pins', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.menu-document')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Interstitials' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Video tools' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate description' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enable mic' })).toHaveCount(0);
  await expect(page.locator('video')).toHaveCount(1);
  const viewport = page.viewportSize()!;
  const timelineBox = await page.locator('.timeline-section').boundingBox();
  expect(timelineBox!.y + timelineBox!.height).toBeLessThanOrEqual(viewport.height);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(viewport.height);
  await expect(page.getByRole('button', { name: /export|download clip/i })).toHaveCount(0);
  await page.locator('.video-stage').hover();
  await expect(page.locator('.video-stage .transport')).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('slider', { name: 'Video timeline' }).fill('12.5');
  await expect(page.locator('.timeline-track')).toHaveCSS('outline-style', 'none');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(12.5, 1);
  await page.getByRole('button', { name: 'Add interstitial P' }).click();
  await page.getByRole('textbox', { name: 'Interstitial prompt' }).fill('Opening moment');
  await page.locator('.video-stage').hover();
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('1.5');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.playbackRate)).toBe(1.5);
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.muted)).toBe(true);
  await page.getByRole('button', { name: 'Loop video' }).click();
  await expect(page.getByRole('button', { name: 'Loop video' })).toHaveClass(/active/);
  await page.reload();
  await page.getByRole('button', { name: 'Select Untitled', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Interstitial prompt' })).toHaveValue('Opening moment');
  await page.getByRole('button', { name: /^Select Untitled at/ }).click();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(12.5, 1);
  await page.getByRole('button', { name: 'Remove Untitled' }).click();
  await expect(page.getByText('No interstitials yet')).toBeVisible();
  await expect(page.locator('.filmstrip img')).toHaveCount(12, { timeout: 60_000 });
  await page.screenshot({ path: 'test-results/player-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('keyboard shortcuts, subtitles and mobile layout', async ({ page }) => {
  await page.locator('.menu-document').click();
  await page.keyboard.press('l');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(10, 0);
  await page.keyboard.press('p');
  await expect(page.getByRole('textbox', { name: 'Interstitial prompt' })).toBeVisible();
  await page.getByLabel('Choose subtitle file').setInputFiles({ name: 'test.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00:00.000 --> 00:00:20.000\nTest subtitle\n') });
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.textTracks[0]?.mode)).toBe('showing');
  await page.locator('.video-stage').hover();
  await page.getByRole('button', { name: 'Toggle captions' }).click();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.textTracks[0]?.mode)).toBe('hidden');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/player-mobile.png', fullPage: true });
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
          videoCodec: await video?.getCodec(), audioCodec: await audio?.getCodec(),
          frames: frames.length, firstFrameTime: await video?.getFirstTimestamp() };
      } finally { input.dispose(); }
    } finally { engine.dispose(); }
  });
  expect(result.mime).toBe('video/mp4'); expect(result.size).toBeGreaterThan(1000);
  expect(result.videoCodec).toBe('avc'); expect(result.audioCodec).toBe('aac');
  expect(result.duration).toBeCloseTo(2.5, 1); expect(result.firstFrameTime).toBeCloseTo(0, 2); expect(result.frames).toBe(3);
});

test('panel dividers resize and persist without page scrolling', async ({ page }) => {
  const side = page.getByRole('separator', { name: 'Resize side panel' });
  const timeline = page.getByRole('separator', { name: 'Resize timeline' });
  const sideBox = await side.boundingBox();
  await page.mouse.move(sideBox!.x + 3, sideBox!.y + 80); await page.mouse.down();
  await page.mouse.move(sideBox!.x - 97, sideBox!.y + 80); await page.mouse.up();
  await expect(side).toHaveAttribute('aria-valuenow', '394');
  await timeline.focus(); await page.keyboard.press('Shift+ArrowUp');
  await expect(timeline).toHaveAttribute('aria-valuenow', '174');
  await page.reload();
  await expect(side).toHaveAttribute('aria-valuenow', '394');
  await expect(timeline).toHaveAttribute('aria-valuenow', '174');
  await expect(page.locator('.sidebar')).toHaveCSS('width', '394px');
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(page.viewportSize()!.height);
  await page.getByRole('slider', { name: 'Video timeline' }).fill('30');
  await page.getByRole('button', { name: 'Add interstitial P' }).click();
  await page.getByRole('slider', { name: 'Video timeline' }).fill('60');
  await page.getByRole('button', { name: 'Add interstitial P' }).click();
  await expect(page.locator('.timeline-pin')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/resizable-panels.png' });
});

// Retained for when the Describe panel returns to the interface.
test.skip('AI panels prepare real frames/audio and real MP4 segments', async ({ page }) => {
  const sent: { url: string; bytes: number; data: string }[] = [];
  await page.route('**/api/analyze/*', async route => {
    const data = route.request().postDataBuffer();
    sent.push({ url: route.request().url(), bytes: data?.length || 0, data: data?.toString('latin1') || '' });
    await route.fulfill({ json: { caption: 'A sample caption.', description: 'A sample description.', provider: route.request().url().endsWith('gemini') ? 'gemini' : 'openai', model: 'test-model', start: 1.25, end: 3.75, basis: 'Test fixture' } });
  });
  await page.getByRole('tab', { name: 'Describe' }).click();
  await page.getByRole('spinbutton', { name: 'Analysis start' }).fill('1.25');
  await page.getByRole('spinbutton', { name: 'Analysis end' }).fill('3.75');
  await page.getByRole('button', { name: 'Generate description' }).click();
  await expect(page.getByText('A sample caption.')).toBeVisible({ timeout: 60_000 });
  expect(sent[0].bytes).toBeGreaterThan(1000); expect(sent[0].data).toContain('data:image/jpeg;base64,'); expect(sent[0].data).toContain('segment.wav');
  await page.getByRole('combobox', { name: 'AI provider' }).selectOption('gemini');
  await page.getByRole('button', { name: 'Generate description' }).click();
  await expect.poll(() => sent.length, { timeout: 60_000 }).toBe(2);
  expect(sent[1].data).toContain('segment.mp4'); expect(sent[1].data).toContain('ftyp');
});
