import { readFile } from 'node:fs/promises';
import { test, expect, openVideo, readProject, saveAndReopen, type Page } from './fixtures';

const fixture = 'tests/fixtures/interstitial-reference.mp4';
const setting = 'Convert imported videos to 24 fps';
async function preferences(page: Page) {
  await page.locator('.playback-options>summary').click();
  await page.getByRole('menuitem', { name: 'Preferences…', exact: true }).click();
  return page.getByRole('dialog', { name: 'Preferences', exact: true });
}
async function rate(page: Page, id: string) {
  return page.evaluate(async id => {
    const { readAsset } = await import('/src/features/project/database.ts' as string);
    const { Input, BlobSource, ALL_FORMATS, EncodedPacketSink } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const asset = await readAsset(id), input = new Input({ source: new BlobSource(asset.blob), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
      const packets = [];
      for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) packets.push({ time: packet.timestamp, duration: packet.duration });
      return { fps: (await track.computePacketStats()).averagePacketRate, width: await track.getDisplayWidth(), height: await track.getDisplayHeight(),
        duration: await input.computeDuration(), audio: audio && { duration: await audio.computeDuration(), start: await audio.getFirstTimestamp(), rate: await audio.getSampleRate() }, packets };
    } finally { input.dispose(); }
  }, id);
}
async function holdConversion(page: Page) {
  await page.evaluate(async () => {
    const { Conversion } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const execute = Conversion.prototype.execute;
    Conversion.prototype.execute = async function () {
      Conversion.prototype.execute = execute;
      await new Promise<void>(resolve => { (window as any).releaseImportConversion = resolve; });
      return execute.call(this);
    };
  });
}

for (const [width, fps] of [[1440, 29.97], [390, 30]]) test(`explicit FPS conversion creates an independent Library copy with stable layout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await openVideo(page);
  const preferenceDialog = await preferences(page); await preferenceDialog.getByRole('switch', { name: setting, exact: true }).check();
  await preferenceDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.story-clip-title').click();
  const before = await readProject(page), original = await rate(page, before.source.assetId);
  await page.getByRole('button', { name: 'Convert frame rate…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Convert frame rate', exact: true }), target = dialog.getByLabel('Target FPS', { exact: true });
  const create = dialog.getByRole('button', { name: 'Create copy', exact: true });
  await target.fill('241'); await expect(create).toBeDisabled();
  await target.fill('0'); await expect(create).toBeDisabled();
  await target.fill(String(fps)); await expect(create).toBeEnabled();
  const positions = () => dialog.locator('h2,input,.hint,.frame-rate-feedback,.frame-rate-actions,button').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  const idle = await positions();
  await dialog.screenshot({ path: `test-results/convert-fps-idle-${width}.png` });
  await holdConversion(page); await create.click();
  await expect.poll(() => page.evaluate(() => !!(window as any).releaseImportConversion)).toBe(true);
  await expect(dialog.getByRole('button', { name: /^Converting/ })).toHaveAttribute('aria-busy', 'true');
  expect(await positions()).toEqual(idle);
  await dialog.screenshot({ path: `test-results/convert-fps-busy-${width}.png` });
  expect(await readProject(page)).toEqual(before);
  await page.evaluate(() => (window as any).releaseImportConversion());
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Video frame rate', { exact: true })).toHaveText(`${fps} fps`);
  const converted = await readProject(page), copy = converted.library.find((a: any) => a.assetId !== before.source.assetId);
  expect(copy).toMatchObject({ name: `interstitial-reference.${fps}fps.mp4`, normalizedFps: fps, originalAssetId: before.source.assetId });
  expect(converted.source).toEqual(before.source); expect(converted.storyFlow).toEqual(before.storyFlow);
  expect(converted.interstitials).toEqual(before.interstitials);
  expect(await rate(page, before.source.assetId)).toEqual(original);
  const media = await rate(page, copy.assetId);
  expect(media.fps).toBeCloseTo(fps, 3); expect([media.width, media.height]).toEqual([original.width, original.height]);
  expect(Math.abs(media.duration - original.duration)).toBeLessThanOrEqual(1 / fps);
  for (const [i, p] of media.packets.entries()) expect(p.time).toBeCloseTo(i / fps, 5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: `Library asset ${copy.name}`, exact: true })).toHaveCount(0);
  expect((await readProject(page)).storyFlow).toEqual(before.storyFlow);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: `Library asset ${copy.name}`, exact: true }).dblclick();
  await expect(page.locator('.story-clip')).toHaveCount(2);
  await expect(page.getByLabel('Video frame rate', { exact: true })).toHaveText(`${fps} fps`);
  expect((await readProject(page)).storyFlow.nodes.find((n: any) => n.name === copy.name).source.assetId).toBe(copy.assetId);
  await page.locator('.clip-inspector').screenshot({ path: `test-results/convert-fps-result-${width}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await saveAndReopen(page);
  const reopened = await readProject(page), savedCopy = reopened.library.find((a: any) => a.name === copy.name);
  expect(savedCopy.normalizedFps).toBe(fps);
  expect((await rate(page, savedCopy.assetId)).fps).toBeCloseTo(fps, 3);
  expect((await rate(page, savedCopy.originalAssetId)).fps).toBe(25);
});

test('explicit conversion can be cancelled or retried after failure without a partial Library copy', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await openVideo(page);
  await page.getByRole('button', { name: 'Library asset interstitial-reference.mp4', exact: true }).click();
  const before = await readProject(page);
  await page.getByRole('button', { name: 'Convert frame rate…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Convert frame rate', exact: true });
  await holdConversion(page); await dialog.getByRole('button', { name: 'Create copy', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).releaseImportConversion)).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as any).releaseImportConversion());
  await expect(page.locator('.project-status')).toHaveCount(0);
  expect(await readProject(page)).toEqual(before);
  await page.getByRole('button', { name: 'Convert frame rate…', exact: true }).click();
  const positions = () => dialog.locator('input,.frame-rate-actions,button').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  const idle = await positions();
  await page.evaluate(async () => {
    const { Conversion } = await import('/node_modules/.vite/deps/mediabunny.js' as string), execute = Conversion.prototype.execute;
    Conversion.prototype.execute = async function () { Conversion.prototype.execute = execute; throw new Error('Conversion test failure'); };
  });
  await dialog.getByRole('button', { name: 'Create copy', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Conversion test failure');
  expect(await positions()).toEqual(idle); expect(await readProject(page)).toEqual(before);
  await dialog.screenshot({ path: 'test-results/convert-fps-error-390.png' });
  await dialog.getByRole('button', { name: 'Create copy', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByLabel('Video frame rate', { exact: true })).toHaveText('24 fps');
  expect((await readProject(page)).library).toHaveLength(2);
});

for (const width of [1440, 390]) test(`import preference normalizes timeline and library videos with stable layout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await openVideo(page);
  await page.locator('.story-clip-title').click();
  await expect(page.getByLabel('Video frame rate', { exact: true })).toHaveText('25 fps');
  const originalProject = await readProject(page), original = await rate(page, originalProject.source.assetId);
  const dialog = await preferences(page), toggle = dialog.getByRole('switch', { name: setting, exact: true });
  await expect(toggle).not.toBeChecked();
  const positions = () => dialog.locator('input,select,footer').evaluateAll(elements => elements.map(el => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  const beforePreference = await positions(); await toggle.check(); expect(await positions()).toEqual(beforePreference);
  await dialog.screenshot({ path: `test-results/import-preference-${width}.png` });
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await readProject(page)).source.assetId).toBe(originalProject.source.assetId);
  await expect(page.getByLabel('Video frame rate', { exact: true })).toHaveText('25 fps');

  await holdConversion(page);
  const bounds = () => page.locator('.workspace-grid').boundingBox();
  const beforeImport = await bounds();
  await page.getByLabel('Import videos onto timeline', { exact: true }).setInputFiles({ name: 'Normalized.mp4', mimeType: 'video/mp4', buffer: await readFile(fixture) });
  await expect(page.locator('.project-status')).toBeVisible();
  expect(await bounds()).toEqual(beforeImport);
  await expect.poll(() => page.evaluate(() => !!(window as any).releaseImportConversion)).toBe(true);
  await page.evaluate(() => (window as any).releaseImportConversion());
  await expect(page.locator('.story-clip')).toHaveCount(2);
  await expect(page.locator('.project-status')).toHaveCount(0);
  expect(await bounds()).toEqual(beforeImport);
  await expect(page.getByLabel('Video frame rate', { exact: true })).toHaveText('24 fps');
  const project = await readProject(page), node = project.storyFlow.nodes.find((n: any) => n.name === 'Normalized.mp4');
  const converted = await rate(page, node.source.assetId);
  expect(converted.fps).toBeCloseTo(24, 5);
  expect([converted.width, converted.height]).toEqual([original.width, original.height]);
  expect(Math.abs(converted.duration - original.duration)).toBeLessThanOrEqual(1 / 24);
  expect(converted.audio).toEqual(original.audio);
  for (const [i, p] of converted.packets.entries()) { expect(p.time).toBeCloseTo(i / 24, 5); expect(p.duration).toBeCloseTo(1 / 24, 5); }
  expect((await rate(page, node.source.originalAssetId)).fps).toBe(25);
  expect(project.library.find((a: any) => a.assetId === node.source.assetId).normalizedFps).toBe(24);

  await page.getByLabel('Import library assets', { exact: true }).setInputFiles({ name: 'Library24.mp4', mimeType: 'video/mp4', buffer: await readFile(fixture) });
  await expect(page.getByRole('button', { name: 'Library asset Library24.mp4', exact: true })).toBeVisible();
  await expect(page.getByLabel('Video frame rate', { exact: true })).toHaveText('24 fps');
  const imported = (await readProject(page)).library.find((a: any) => a.name === 'Library24.mp4');
  expect(imported.normalizedFps).toBe(24); expect((await rate(page, imported.originalAssetId)).fps).toBe(25);
  await page.getByRole('button', { name: 'Library asset Library24.mp4', exact: true }).dblclick();
  await expect(page.locator('.story-clip')).toHaveCount(3);
  expect((await readProject(page)).storyFlow.nodes.find((n: any) => n.name === 'Library24.mp4').source.assetId).toBe(imported.assetId);
  await expect(page.getByLabel('Video frame rate', { exact: true })).toHaveText('24 fps');
  await page.locator('.clip-inspector').screenshot({ path: `test-results/fps-inspector-${width}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('converted primary imports survive preference reset and project reopening without encoding again', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('fps-test-initialized')) { localStorage.setItem('sparko:convert-imported-video-24fps', 'true'); localStorage.setItem('fps-test-initialized', 'true'); }
    (window as any).encodedFrames = 0;
    const encode = VideoEncoder.prototype.encode;
    VideoEncoder.prototype.encode = function (...args) { (window as any).encodedFrames++; return encode.apply(this, args); };
  });
  await openVideo(page); await page.locator('.story-clip-title').click();
  await expect(page.getByLabel('Video frame rate', { exact: true })).toHaveText('24 fps');
  expect(await page.evaluate(() => (window as any).encodedFrames)).toBeGreaterThan(0);
  const before = await readProject(page);
  expect((await rate(page, before.source.originalAssetId)).fps).toBe(25);
  let dialog = await preferences(page); await expect(dialog.getByRole('switch', { name: setting, exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Reset default', exact: true }).click();
  await expect(dialog.getByRole('switch', { name: setting, exact: true })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.evaluate(() => { (window as any).encodedFrames = 0; });
  await saveAndReopen(page);
  await page.locator('.story-clip-title').click();
  await expect(page.getByLabel('Video frame rate', { exact: true })).toHaveText('24 fps');
  expect(await page.evaluate(() => (window as any).encodedFrames)).toBe(0);
  const after = await readProject(page);
  expect(after.library.find((a: any) => a.assetId === after.source.assetId).normalizedFps).toBe(24);
  expect((await rate(page, after.source.originalAssetId)).fps).toBe(25);
  dialog = await preferences(page); await expect(dialog.getByRole('switch', { name: setting, exact: true })).not.toBeChecked();
});

test('cancelling import conversion leaves the project and asset storage unchanged', async ({ page }) => {
  await openVideo(page);
  const dialog = await preferences(page); await dialog.getByRole('switch', { name: setting, exact: true }).check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  const before = await readProject(page);
  await holdConversion(page);
  await page.getByLabel('Import library assets', { exact: true }).setInputFiles(fixture);
  await expect.poll(() => page.evaluate(() => !!(window as any).releaseImportConversion)).toBe(true);
  await page.getByRole('button', { name: 'Cancel project operation', exact: true }).click();
  await page.evaluate(() => (window as any).releaseImportConversion());
  await expect(page.locator('.project-status')).toHaveCount(0);
  expect(await readProject(page)).toEqual(before);
  const count = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('sparko-projects'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await new Promise<number>(resolve => { const r = db.transaction('assets').objectStore('assets').count(); r.onsuccess = () => resolve(r.result); }); }
    finally { db.close(); }
  });
  expect(count).toBe(1);
});

test('24 fps and fractional FPS conversions preserve audio packets and timing', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, CanvasSource, AudioBufferSource, EncodedPacketSink } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { ensureAac } = await import('/src/media/media.ts' as string); await ensureAac();
    const { prepareSourceVideo, convertVideoFrameRate } = await import('/src/media/prepareVideo.ts' as string);
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    const canvas = new OffscreenCanvas(160, 96); canvas.getContext('2d')!.fillRect(0, 0, 160, 96);
    const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 100_000 }), audio = new AudioBufferSource({ codec: 'aac', bitrate: 128_000 });
    output.addVideoTrack(video, { frameRate: 25 }); output.addAudioTrack(audio); await output.start();
    const buffer = new AudioBuffer({ numberOfChannels: 2, length: 96000, sampleRate: 48000 });
    for (let c = 0; c < 2; c++) { const values = buffer.getChannelData(c); for (let i = 0; i < values.length; i++) values[i] = .1 * Math.sin(i * 2 * Math.PI * 440 / 48000); }
    await Promise.all([(async () => { for (let i = 0; i < 50; i++) await video.add(i / 25, 1 / 25); video.close(); })(), (async () => { await audio.add(buffer); audio.close(); })()]);
    await output.finalize();
    const original = new Blob([output.target.buffer], { type: 'video/mp4' });
    const converted = await prepareSourceVideo(original, new AbortController().signal, () => undefined, true);
    const inspect = async (blob: Blob) => {
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryAudioTrack(), packets = [];
        for await (const p of new EncodedPacketSink(track).packets()) packets.push({ time: p.timestamp, duration: p.duration, data: Array.from(p.data) });
        return { fps: (await (await input.getPrimaryVideoTrack()).computePacketStats()).averagePacketRate, packets, rate: await track.getSampleRate(), duration: await input.computeDuration() };
      } finally { input.dispose(); }
    };
    const fractional = await convertVideoFrameRate(original, 29.97, new AbortController().signal, () => undefined);
    return { original: await inspect(original), converted: await inspect(converted), fractional: await inspect(fractional) };
  });
  expect(result.original.fps).toBe(25); expect(result.converted.fps).toBeCloseTo(24, 5);
  expect(result.converted.packets).toEqual(result.original.packets);
  expect(result.converted.rate).toBe(result.original.rate);
  expect(result.converted.duration).toBeCloseTo(result.original.duration, 5);
  expect(result.fractional.fps).toBeCloseTo(29.97, 3);
  expect(result.fractional.packets).toEqual(result.original.packets);
  expect(result.fractional.rate).toBe(result.original.rate);
  expect(Math.abs(result.fractional.duration - result.original.duration)).toBeLessThanOrEqual(1 / 29.97);
});
