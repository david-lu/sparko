import { showImageReferences, test, expect, readProject, saveAndReopen, dragIntoView, addDraft, addBridge, openGenerationTimeline, closeGenerationTimeline, type Page } from './fixtures';
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

for (const width of [1440, 390]) test(`AI editing from generation uses its visible preview and handles empty input at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/api/status', async route => {
    const status = await (await route.fetch()).json();
    await route.fulfill({ json: { ...status, providers: { ...status.providers, openai: true, fal: true } } });
  });
  await openColors(page); await addBridge(page);
  const saved = await page.evaluate(async () => {
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    const { packProject } = await import('/src/features/project/archive.ts' as string);
    const project = await readActiveProject(), item = project.interstitials[0], asset = await readAsset(project.source.assetId);
    item.phase = 'ready'; item.result = { assetId: asset.id, url: 'asset:' + asset.id, start: 0, duration: 4, totalDuration: 4 };
    const archive = await packProject(project, [asset], new AbortController().signal, () => {});
    return [...new Uint8Array(await archive.arrayBuffer())];
  });
  await page.getByLabel('Choose project file', { exact: true }).setInputFiles({ name: 'Preview.sparko', mimeType: 'application/zip', buffer: Buffer.from(saved) });
  await page.locator('.story-clip.type-simple .story-clip-title').click();
  const prompt = page.getByLabel('Video prompt', { exact: true }); await prompt.fill('Keep this scene.');
  const region = await openGenerationTimeline(page), ruler = region.getByRole('slider', { name: 'Timeline ruler', exact: true });
  await page.getByRole('button', { name: 'Edit generation timeline', exact: true }).click();
  const bodies: any[] = [];
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ json: { prompt: `Edited scene ${bodies.length}.`, model: 'test' } });
  });
  const edit = async (color?: boolean[]) => {
    const count = bodies.length;
    await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit prompt with AI', exact: true });
    await dialog.getByLabel('What should change?', { exact: true }).fill('Make it more cheerful.');
    await dialog.getByRole('button', { name: 'Apply edit', exact: true }).click();
    await expect(prompt).toHaveValue(`Edited scene ${count + 1}.`, { timeout: 15000 });
    const body = bodies.at(-1); expect(body.editInstructions).toBe('Make it more cheerful.');
    if (!color) expect(body).not.toHaveProperty('currentFrame');
    else {
      expect(body.currentFrame).toMatch(/^data:image\/jpeg;base64,/); expect(body.currentFrame.length).toBeLessThanOrEqual(32_000);
      const actual = await page.evaluate(async url => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        const canvas = new OffscreenCanvas(1, 1), context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0, 1, 1); bitmap.close();
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value > 128);
      }, body.currentFrame);
      expect(actual).toEqual(color);
    }
  };
  await edit(); // The unfilled Input interval has no frame, even with a saved result.
  expect(bodies[0].referenceFrames).toHaveLength(2);
  await expect(region.getByRole('button', { name: 'Input', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(region.locator('.generation-player-screen')).toHaveAttribute('data-empty', 'true');
  await ruler.press('Home'); for (let i = 0; i < 3; i++) await ruler.press('Shift+ArrowRight');
  await edit([false, true, false]); // Reference trim offset plus frame 30, not the hidden story playhead.
  const referenceFrame = bodies.at(-1).currentFrame;
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect(prompt).toHaveValue('Edited scene 3.', { timeout: 15000 });
  expect(bodies.at(-1).currentFrame).toBe(referenceFrame);
  await region.getByRole('button', { name: 'Generated', exact: true }).click();
  await ruler.press('Home'); for (let i = 0; i < 6; i++) await ruler.press('Shift+ArrowRight');
  await edit([false, false, true]); // Generated frame 60 = 2.5 seconds.
  await region.getByRole('button', { name: 'Add image keyframe', exact: true }).click();
  const image = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(24, 24), context = canvas.getContext('2d')!;
    context.fillStyle = '#ff00ff'; context.fillRect(0, 0, 24, 24);
    return [...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer())];
  });
  await region.getByLabel('Upload Keyframe image', { exact: true }).setInputFiles({ name: 'magenta.png', mimeType: 'image/png', buffer: Buffer.from(image) });
  await expect(region.getByRole('group', { name: 'Keyframe image', exact: true })).toHaveAttribute('aria-busy', 'false');
  await edit([true, false, true]);
  const keyframe = bodies.at(-1).currentFrame;
  await page.getByRole('button', { name: 'Add image', exact: true }).press('Enter');
  const imagePrompt = page.getByLabel('Generation prompt', { exact: true }); await imagePrompt.fill('A cheerful scene.');
  await page.route('**/api/image-prompts/enhance', async route => {
    const body = route.request().postDataJSON(); expect(body.currentFrame).toBe(keyframe);
    await route.fulfill({ json: { prompt: 'A cheerful magenta scene.', model: body.settings.model } });
  });
  await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
  const imageDialog = page.getByRole('dialog', { name: 'Edit prompt with AI', exact: true });
  await imageDialog.getByLabel('What should change?', { exact: true }).fill('Add more detail.');
  await imageDialog.getByRole('button', { name: 'Apply edit', exact: true }).click();
  await expect(imagePrompt).toHaveValue('A cheerful magenta scene.', { timeout: 15000 });
  await closeGenerationTimeline(page);
  await page.locator('.story-clip.type-source .story-filmstrip').first().press('Home');
  await page.locator('.story-clip.type-simple .story-clip-title').press('Enter');
  await edit([true, false, false]); // Closing restores capture from the story player.
  await expect(region).toHaveCount(0);
});

for (const kind of ['video', 'image'] as const) for (const width of [1440, 390]) test(`${kind} enhancement snapshots the displayed trimmed frame and cancels capture at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/api/status', async route => {
    const response = await route.fetch(), status = await response.json();
    await route.fulfill({ json: { ...status, providers: { ...status.providers, openai: true, comfy: true, fal: true } } });
  });
  await openColors(page);
  await page.locator('.story-clip-title').click();
  await page.getByLabel('Source in', { exact: true }).fill('1');
  await page.getByLabel('Source out', { exact: true }).fill('3.5');
  const strip = page.locator('.story-filmstrip');
  await strip.press('Home'); await strip.press('Shift+ArrowRight');
  for (let frame = 0; frame < 12; frame++) await strip.press('ArrowRight');
  if (kind === 'video') await addDraft(page);
  else await page.getByRole('button', { name: 'Add image', exact: true }).press('Enter');
  const prompt = page.getByLabel(kind === 'video' ? 'Video prompt' : 'Generation prompt', { exact: true });
  await prompt.fill('Keep the current scene and add a bird.');
  await expect(page.locator('.buffering')).toHaveCount(0);
  let body: any, requests = 0;
  await page.route(kind === 'video' ? '**/api/interstitials/enhance-prompt' : '**/api/image-prompts/enhance', async route => {
    requests++; body = route.request().postDataJSON();
    await route.fulfill({ json: { prompt: 'A bird in the current scene.', model: body.settings?.model ?? 'test' } });
  });
  // Delay only the first real snapshot, so cancellation is tested during capture.
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      if (!this.classList.contains('playback-canvas')) return original.call(this, callback, ...args);
      HTMLCanvasElement.prototype.toBlob = original;
      original.call(this, blob => { (window as any).releasePromptFrame = () => callback(blob); }, ...args);
    };
  });
  const enhance = page.getByRole('button', { name: 'Enhance prompt', exact: true });
  await enhance.scrollIntoViewIfNeeded();
  const positions = () => page.locator('.clip-inspector').evaluate(root => ['textarea', '.generation-timeline-summary, .asset-input', 'button[type=submit]'].map(selector => {
    const r = root.querySelector(selector)!.getBoundingClientRect(); return { y: r.top - root.getBoundingClientRect().top, height: r.height };
  }));
  const before = await positions();
  await enhance.click();
  await page.waitForFunction(() => typeof (window as any).releasePromptFrame === 'function');
  expect(await positions()).toEqual(before); expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Cancel prompt enhancement', exact: true }).click();
  await page.evaluate(() => (window as any).releasePromptFrame());
  await expect(enhance).toBeEnabled();
  await expect(prompt).toHaveValue('Keep the current scene and add a bird.');
  expect(requests).toBe(0);
  await enhance.click();
  await expect(page.getByLabel('Enhanced prompt', { exact: true })).toHaveValue('A bird in the current scene.');
  expect(requests).toBe(1); expect(await positions()).toEqual(before);
  expect(body.currentFrame).toMatch(/^data:image\/jpeg;base64,/);
  expect(body.currentFrame.length).toBeLessThanOrEqual(32_000);
  const color = await page.evaluate(async url => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = new OffscreenCanvas(1, 1), context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0, 1, 1); bitmap.close();
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value > 128);
  }, body.currentFrame);
  expect(color).toEqual([false, false, true]); // Source 2.5s, not its first frame or the trim start.
  expect((await readProject(page)).library.filter((asset: any) => asset.kind === 'image')).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

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
    await addDraft(page); await showImageReferences(page);
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
