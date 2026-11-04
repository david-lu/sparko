import { test, expect, readProject, saveAndReopen, dragIntoView, addDraft, type Page } from './fixtures';
import { writeClipMetadata } from '../../src/media/clipMetadata';
import { clipMetadata } from '../fixtures/clip-metadata';

async function openColors(page: Page, generated = false) {
  await page.goto('/');
  const bytes = await page.evaluate(async () => {
    const { BufferTarget, CanvasSource, Mp4OutputFormat, Output } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const canvas = new OffscreenCanvas(320, 180), context = canvas.getContext('2d')!;
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat() });
    const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 300_000 });
    output.addVideoTrack(video, { frameRate: 24 }); await output.start();
    for (let frame = 0; frame < 96; frame++) {
      context.fillStyle = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'][Math.floor(frame / 24)];
      context.fillRect(0, 0, 320, 180); await video.add(frame / 24, 1 / 24);
    }
    video.close(); await output.finalize(); return Array.from(new Uint8Array(output.target.buffer));
  });
  let blob = new Blob([Uint8Array.from(bytes)], { type: 'video/mp4' });
  if (generated) blob = await writeClipMetadata(blob, clipMetadata, new AbortController().signal);
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles({ name: 'colors.mp4', mimeType: 'video/mp4', buffer: Buffer.from(await blob.arrayBuffer()) });
  await expect(page.locator('.story-clip')).toHaveCount(1);
}

async function capturedImage(page: Page) {
  return page.evaluate(async () => {
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    const project = await readActiveProject(), image = project.library.findLast((asset: any) => asset.kind === 'image');
    const { blob } = await readAsset(image.assetId), bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(1, 1), context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0, 1, 1); bitmap.close();
    return { name: image.name, width: image.width, height: image.height, type: blob.type,
      color: [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value > 128) };
  });
}

async function openCaptureMenu(page: Page) {
  await page.locator('.playback-canvas').click({ button: 'right', position: { x: 20, y: 20 } });
  const capture = page.getByRole('menuitem', { name: 'Create image from playhead', exact: true });
  await expect(capture).toBeEnabled(); return capture;
}

for (const width of [1440, 390]) test(`capture uses the trimmed playhead frame and keeps controls stable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await openColors(page);
  await page.locator('.story-clip-title').click();
  await page.getByLabel('Source in', { exact: true }).fill('1');
  await page.getByLabel('Source out', { exact: true }).fill('3.5');
  const strip = page.locator('.story-filmstrip'); await strip.press('Home'); await strip.press('Shift+ArrowRight');
  for (let frame = 0; frame < 12; frame++) await strip.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Create image from playhead', exact: true })).toHaveCount(0);
  const capture = await openCaptureMenu(page);
  const bounds = (await page.getByRole('menu', { name: 'Video actions', exact: true }).boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  // Hold the real PNG callback to inspect the loading state without a timing race.
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      if (!this.classList.contains('playback-canvas')) return original.call(this, callback, ...args);
      return original.call(this, blob => { (window as any).releaseCapture = () => callback(blob); }, ...args);
    };
  });
  const positions = () => page.locator('.transport, .transport button, .story-canvas').evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height };
  }));
  const before = await positions(); await capture.click();
  await expect(capture).toHaveCount(0); await expect(page.locator('.capture-progress')).toBeVisible();
  expect(await positions()).toEqual(before);
  await page.waitForFunction(() => typeof (window as any).releaseCapture === 'function');
  await page.screenshot({ path: `test-results/frame-capture-${width}-loading.png` });
  await page.evaluate(() => (window as any).releaseCapture());
  await expect(page.locator('.capture-progress')).toHaveCount(0);
  expect(await positions()).toEqual(before);
  const image = await capturedImage(page);
  expect(image).toMatchObject({ width: 320, height: 180, type: 'image/png', color: [false, false, true] });
  expect(image.name).toContain('frame 37');
  await expect(page.getByLabel('Asset name', { exact: true })).toHaveValue(image.name);
  await expect(page.locator('.asset-preview img')).toBeVisible();
  await expect(page.locator('.story-clip')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `test-results/frame-capture-${width}-ready.png` });
  if (width === 1440) {
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await readProject(page)).library.filter((asset: any) => asset.kind === 'image').length).toBe(0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await saveAndReopen(page); expect(await capturedImage(page)).toEqual(image);
    await addDraft(page);
    await dragIntoView(page, page.getByRole('button', { name: `Library asset ${image.name}`, exact: true }), page.getByRole('group', { name: 'Image references', exact: true }));
    await expect(page.getByRole('button', { name: 'Remove Picture 1', exact: true })).toBeVisible();
  }
});

for (const width of [1440, 390]) test(`generated video capture uses the playable body and recovers without layout shifts at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await openColors(page, true); await expect(page.locator('.story-clip.type-simple')).toHaveCount(1);
  await page.locator('.story-filmstrip').press('Home');
  await expect(page.locator('.story-playhead>span')).toHaveText('00:01.000');
  let capture = await openCaptureMenu(page);
  const before = await page.locator('.video-stage').boundingBox();
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      if (!this.classList.contains('playback-canvas')) return original.call(this, callback, ...args);
      HTMLCanvasElement.prototype.toBlob = original; callback(null);
    };
  });
  await capture.click(); await expect(page.locator('.capture-error')).toContainText('Unable to create an image');
  capture = await openCaptureMenu(page);
  expect(await page.locator('.video-stage').boundingBox()).toEqual(before);
  expect((await readProject(page)).library.filter((asset: any) => asset.kind === 'image')).toHaveLength(0);
  await capture.click(); await expect(page.locator('.asset-preview img')).toBeVisible();
  await expect(page.locator('.capture-error')).toHaveCount(0);
  expect(await page.locator('.video-stage').boundingBox()).toEqual(before);
  expect(await capturedImage(page)).toMatchObject({ width: 320, height: 180, color: [false, true, false] });
});

test('video context menu supports keyboard dismissal, fullscreen and read-only preview', async ({ page }) => {
  await openColors(page);
  const stage = page.getByRole('group', { name: 'Video preview', exact: true });
  const menu = page.getByRole('menu', { name: 'Video actions', exact: true });
  await stage.hover(); await page.getByRole('button', { name: 'Play', exact: true }).click();
  await openCaptureMenu(page);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(stage).toBeFocused();
  await page.getByRole('button', { name: 'Play video', exact: true }).click({ button: 'right' });
  await expect(menu).toBeVisible(); await page.keyboard.press('Escape');
  await stage.press('Shift+F10'); await expect(menu).toBeVisible();
  await page.getByRole('button', { name: 'Library menu', exact: true }).click();
  await expect(menu).toHaveCount(0); await page.keyboard.press('Escape');
  await stage.hover(); await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  const capture = await openCaptureMenu(page);
  expect(await menu.evaluate(element => document.fullscreenElement?.contains(element))).toBe(true);
  await capture.click(); await expect.poll(async () => (await readProject(page)).library.filter((asset: any) => asset.kind === 'image').length).toBe(1);
  await stage.hover(); await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.locator('.playback-canvas').click({ button: 'right', position: { x: 20, y: 20 } });
  await expect(menu).toHaveCount(0);
});
