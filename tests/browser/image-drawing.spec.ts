import { test, expect, readProject, saveAndReopen, type Page } from './fixtures';

async function openImage(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: /^New project/ }).click();
  const bytes = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(320, 180), context = canvas.getContext('2d')!;
    context.fillStyle = '#00ff00'; context.fillRect(0, 0, 320, 180); context.clearRect(0, 0, 8, 8);
    return Array.from(new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await page.getByLabel('Import videos onto timeline', { exact: true }).setInputFiles({ name: 'Drawing.png', mimeType: 'image/png', buffer: Buffer.from(bytes) });
  await expect(page.locator('.story-clip')).toHaveCount(1); await page.locator('.story-clip-title').click();
  await expect(page.getByLabel('Media dimensions', { exact: true })).toHaveText('320 × 180');
  await expect(page.locator('.clip-inspector').getByRole('button', { name: 'Draw on image…', exact: true })).toHaveCount(0);
}
async function drawingMenu(page: Page, library = false) {
  const trigger = library ? page.getByRole('button', { name: 'Library asset Drawing.png', exact: true }) : page.locator('.story-clip-title');
  await trigger.click({ button: 'right' });
  return page.getByRole('menuitem', { name: 'Draw on image…', exact: true });
}
async function pixels(page: Page, assetId: string) {
  return page.evaluate(async id => {
    const { readAsset } = await import('/src/features/project/database.ts' as string);
    const { blob } = await readAsset(id), image = await createImageBitmap(blob), canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0); image.close();
    const sample = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
    return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), width: canvas.width, height: canvas.height, left: sample(80, 90), center: sample(160, 90), corner: sample(0, 0) };
  }, assetId);
}
async function stroke(page: Page) {
  const canvas = page.getByLabel('Image drawing canvas', { exact: true }); await canvas.scrollIntoViewIfNeeded();
  const r = (await canvas.boundingBox())!;
  await page.mouse.move(r.x + r.width / 4, r.y + r.height / 2); await page.mouse.down();
  await page.mouse.move(r.x + r.width * .75, r.y + r.height / 2, { steps: 12 }); await page.mouse.up();
}

for (const width of [1440, 390]) test(`drawing saves a new image with undo, eraser, transparency and stable layout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 }); await openImage(page);
  const before = await readProject(page), original = await pixels(page, before.source.assetId);
  if (width === 390) await page.getByRole('button', { name: 'Reveal in Library', exact: true }).click();
  await expect(page.locator('.clip-inspector').getByRole('button', { name: 'Draw on image…', exact: true })).toHaveCount(0);
  const draw = await drawingMenu(page, width === 390); await expect(draw).toBeEnabled();
  await page.screenshot({ path: `test-results/draw-image-action-${width}.png`, fullPage: true });
  await page.evaluate(() => {
    const decode = window.createImageBitmap;
    const loading = new Promise<void>(resolve => { (window as any).loadDrawing = () => { window.createImageBitmap = decode; resolve(); }; });
    // Thumbnail decoding can race with the popup. Hold every decode until the test releases it.
    window.createImageBitmap = async (...args: any[]) => {
      await loading;
      return (decode as any)(...args);
    };
  });
  await draw.click();
  const dialog = page.getByRole('dialog', { name: 'Draw on image', exact: true }), canvas = dialog.getByLabel('Image drawing canvas', { exact: true });
  const geometry = () => dialog.locator('h2,.drawing-toolbar,.drawing-stage,.hint,.drawing-feedback,footer').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
  await expect(dialog.getByText('Loading image…', { exact: true })).toBeVisible();
  const loading = await geometry();
  await expect.poll(() => page.evaluate(() => !!(window as any).loadDrawing)).toBe(true);
  await page.evaluate(() => (window as any).loadDrawing());
  await expect(canvas).toBeVisible();
  expect(await geometry()).toEqual(loading);
  const save = dialog.getByRole('button', { name: 'Save as new asset', exact: true }); await expect(save).toBeDisabled();
  await dialog.getByLabel('Brush color', { exact: true }).fill('#ff0000'); await dialog.getByLabel('Brush size', { exact: true }).fill('20');
  await stroke(page); await expect(save).toBeEnabled();
  const center = () => canvas.evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(160, 90, 1, 1).data));
  expect(await center()).toEqual([255, 0, 0, 255]);
  await dialog.getByRole('button', { name: 'Undo drawing', exact: true }).click(); expect(await center()).toEqual([0, 255, 0, 255]); await expect(save).toBeDisabled();
  await dialog.getByRole('button', { name: 'Redo drawing', exact: true }).click(); expect(await center()).toEqual([255, 0, 0, 255]);
  await dialog.getByRole('button', { name: 'Eraser', exact: true }).click();
  await canvas.click(); expect(await center()).toEqual([0, 255, 0, 255]);
  await dialog.getByRole('button', { name: 'Clear drawing', exact: true }).click(); await expect(save).toBeDisabled();
  await dialog.getByRole('button', { name: 'Undo drawing', exact: true }).click(); await expect(save).toBeEnabled();
  const idle = await geometry(); await dialog.screenshot({ path: `test-results/image-drawing-${width}.png` });
  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      HTMLCanvasElement.prototype.toBlob = toBlob;
      (window as any).finishDrawing = () => toBlob.apply(this, args);
    };
  });
  await save.click(); await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toHaveAttribute('aria-busy', 'true');
  expect(await geometry()).toEqual(idle); expect((await readProject(page)).library).toEqual(before.library);
  await page.evaluate(() => (window as any).finishDrawing()); await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Asset name', { exact: true })).toHaveValue('Drawing.drawn.png');
  await expect(page.getByLabel('Media dimensions', { exact: true })).toHaveText('320 × 180');
  const after = await readProject(page), copy = after.library.find((a: any) => a.assetId !== before.source.assetId);
  expect(copy).toMatchObject({ kind: 'image', width: 320, height: 180, originalAssetId: before.source.assetId });
  expect(after.storyFlow).toEqual(before.storyFlow); expect(await pixels(page, before.source.assetId)).toEqual(original);
  expect(await pixels(page, copy.assetId)).toMatchObject({ width: 320, height: 180, left: [255, 0, 0, 255], center: [0, 255, 0, 255], corner: [0, 0, 0, 0] });
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect((await readProject(page)).library).toHaveLength(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect((await readProject(page)).library).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await saveAndReopen(page);
  const savedCopy = (await readProject(page)).library.find((a: any) => a.name === copy.name);
  expect(await pixels(page, savedCopy.assetId)).toMatchObject({ left: [255, 0, 0, 255], center: [0, 255, 0, 255], corner: [0, 0, 0, 0] });
});

test('drawing can be cancelled and retried after an export error without saving partial assets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await openImage(page);
  const before = await readProject(page);
  const draw = await drawingMenu(page);
  await page.screenshot({ path: 'test-results/draw-image-timeline-menu-390.png', fullPage: true });
  await draw.click(); const dialog = page.getByRole('dialog', { name: 'Draw on image', exact: true });
  await expect(dialog.getByLabel('Image drawing canvas', { exact: true })).toBeVisible(); await stroke(page);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(page.getByLabel('Clip graph', { exact: true })).toBeFocused(); expect(await readProject(page)).toEqual(before);
  await (await drawingMenu(page)).click(); await expect(dialog.getByLabel('Image drawing canvas', { exact: true })).toBeVisible(); await stroke(page);
  const geometry = () => dialog.locator('.drawing-stage,.drawing-feedback,footer').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
  const idle = await geometry();
  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback) { HTMLCanvasElement.prototype.toBlob = toBlob; callback(null); };
  });
  await dialog.getByRole('button', { name: 'Save as new asset', exact: true }).click();
  await expect(dialog.getByRole('status', { name: 'Drawing status', exact: true })).toHaveText('Unable to save this drawing.'); expect(await geometry()).toEqual(idle); expect(await readProject(page)).toEqual(before);
  await dialog.getByRole('button', { name: 'Save as new asset', exact: true }).click(); await expect(dialog).toHaveCount(0); expect((await readProject(page)).library).toHaveLength(2);
});

test('cancelling an image save ignores its late PNG export', async ({ page }) => {
  await openImage(page); const before = await readProject(page);
  await (await drawingMenu(page)).click();
  const dialog = page.getByRole('dialog', { name: 'Draw on image', exact: true });
  await expect(dialog.getByLabel('Image drawing canvas', { exact: true })).toBeVisible(); await stroke(page);
  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) { HTMLCanvasElement.prototype.toBlob = toBlob; (window as any).finishDrawing = () => toBlob.apply(this, args); };
  });
  await dialog.getByRole('button', { name: 'Save as new asset', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).finishDrawing)).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as any).finishDrawing()); await expect(page.locator('.project-status')).toHaveCount(0);
  expect(await readProject(page)).toEqual(before);
});
