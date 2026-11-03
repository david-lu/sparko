import { expect, test, type Locator } from '@playwright/test';
import { fitAll } from './fixtures';

async function expectTimes(strip: Locator, start: number, end: number, times: number[]) {
  await expect(strip.locator('img')).toHaveCount(times.length);
  const positions = await strip.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll('img'), image => {
      const frame = image.getBoundingClientRect();
      return (frame.x + frame.width / 2 - bounds.x) / bounds.width;
    });
  });
  // Browser layout rounds to subpixels; the timestamp must still land within one project frame.
  positions.forEach((position, index) => expect(Math.abs(start + position * (end - start) - times[index])).toBeLessThan(1 / 24));
}

for (const width of [1440, 390]) {
  test(`thumbnail timestamps stay aligned through trimming, zooming and splitting at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled();
    const bytes = await page.evaluate(async () => {
      const { BufferTarget, CanvasSource, Mp4OutputFormat, Output } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
      const canvas = new OffscreenCanvas(320, 180), context = canvas.getContext('2d')!;
      const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat() });
      const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 300_000 });
      output.addVideoTrack(video, { frameRate: 24 });
      await output.start();
      for (let frame = 0; frame < 480; frame++) {
        context.fillStyle = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'][Math.floor(frame / 120)];
        context.fillRect(0, 0, 320, 180);
        await video.add(frame / 24, 1 / 24);
      }
      video.close(); await output.finalize();
      return Array.from(new Uint8Array(output.target.buffer));
    });
    await page.getByLabel('Choose video file', { exact: true }).setInputFiles({ name: 'timed-colors.mp4', mimeType: 'video/mp4', buffer: Buffer.from(bytes) });
    const clip = page.locator('.story-clip'), strip = clip.locator('.video-filmstrip');
    await expect(strip.locator('img')).toHaveCount(4);
    await expectTimes(strip, 0, 20, [2.5, 7.5, 12.5, 17.5]);
    const sources = await strip.locator('img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src));
    const colors = await strip.locator('img').evaluateAll(async images => Promise.all(images.map(async element => {
      const image = element as HTMLImageElement; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value > 128);
    })));
    expect(colors).toEqual([[true, false, false], [false, true, false], [false, false, true], [true, true, false]]);

    await clip.locator('.story-clip-title').click();
    await page.getByLabel('Source in', { exact: true }).fill('3');
    await page.getByLabel('Source out', { exact: true }).fill('17');
    await expectTimes(strip, 3, 17, [2.5, 7.5, 12.5, 17.5]);
    await fitAll(page);
    const thumbnail = (await strip.locator('img').nth(1).boundingBox())!;
    await page.mouse.click(thumbnail.x + thumbnail.width / 2, thumbnail.y + thumbnail.height / 2);
    await expect(clip.getByRole('slider')).toHaveAttribute('aria-valuenow', '4.5');
    // Each tile is narrower than the old 76px minimum at this zoom.
    await fitAll(page);
    for (let step = 0; step < 6; step++) await page.getByRole('button', { name: 'Zoom out story', exact: true }).click();
    expect((await strip.boundingBox())!.width).toBeLessThan(4 * 76);
    await expectTimes(strip, 3, 17, [2.5, 7.5, 12.5, 17.5]);
    expect(await strip.locator('img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src))).toEqual(sources);
    await expect(strip.getByRole('status')).toHaveCount(0);

    const scrubber = clip.getByRole('slider');
    await scrubber.focus(); await page.keyboard.press('Home');
    for (let second = 0; second < 6; second++) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('s');
    await expect(page.locator('.story-clip')).toHaveCount(2);
    await expectTimes(page.locator('.story-clip').nth(0).locator('.video-filmstrip'), 3, 9, [2.5, 7.5]);
    await expectTimes(page.locator('.story-clip').nth(1).locator('.video-filmstrip'), 9, 17, [7.5, 12.5, 17.5]);
    await expect(page.locator('.story-clip .clip-loading')).toHaveCount(0);
  });
}
