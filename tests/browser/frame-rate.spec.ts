import { expect, test, openVideo, seekSource, saveAndReopen } from './fixtures';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.route('**/media/sample.mp4', route => route.fulfill({ path: 'tests/fixtures/interstitial-reference.mp4', contentType: 'video/mp4' }));
});

test('plays a 25 fps source natively without encoding and reuses it after reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    (window as any).encodedFrames = 0;
    const encode = VideoEncoder.prototype.encode;
    VideoEncoder.prototype.encode = function (...args) {
      (window as any).encodedFrames++;
      return encode.apply(this, args);
    };
  });
  await openVideo(page);
  const native = await page.evaluate(async () => {
    const { Input, BlobSource, ALL_FORMATS } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    const project = await readActiveProject();
    const source = await readAsset(project.source.assetId);
    const input = new Input({ source: new BlobSource(source.blob), formats: ALL_FORMATS });
    try { return { assetId: source.id, originalAssetId: project.source.originalAssetId,
      fps: (await (await input.getPrimaryVideoTrack()).computePacketStats()).averagePacketRate,
      bytes: [...new Uint8Array(await source.blob.arrayBuffer())] }; }
    finally { input.dispose(); }
  });
  expect(native.originalAssetId).toBeUndefined(); expect(native.fps).toBe(25);
  expect(Buffer.from(native.bytes)).toEqual(await readFile('tests/fixtures/interstitial-reference.mp4'));
  await seekSource(page, 1);
  await page.locator('.story-filmstrip').press('ArrowRight');
  await expect(page.locator('.story-filmstrip')).toHaveAttribute('aria-valuenow', String(25 / 24));
  await page.locator('.video-stage').hover(); await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number(await page.locator('.story-filmstrip').getAttribute('aria-valuenow'))).toBeGreaterThan(1.2);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(await page.evaluate(() => (window as any).encodedFrames)).toBe(0);
  await saveAndReopen(page);
  expect(await page.evaluate(async () => {
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    const source = await readAsset((await readActiveProject()).source.assetId);
    return [...new Uint8Array(await source.blob.arrayBuffer())];
  })).toEqual(native.bytes);
  expect(await page.evaluate(() => (window as any).encodedFrames)).toBe(0);
  expect(errors).toEqual([]);
});

test('converts only a short generation reference from a native 25 fps source', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled();
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.menu-document')).toHaveText('interstitial-reference.mp4');
  const rates = await page.evaluate(async () => {
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    const { exportMp4 } = await import('/src/media/media.ts' as string);
    const { Input, BlobSource, ALL_FORMATS } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const project = await readActiveProject();
    const source = await readAsset(project.source.assetId);
    const reference = await exportMp4({ id: source.id, name: source.name, url: '', file: new File([source.blob], source.name, { type: source.blob.type }) },
      { start: 0, end: 2 }, { maxHeight: 768, frameRate: 24 });
    const rate = async (blob: Blob) => {
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      try { return (await (await input.getPrimaryVideoTrack()).computePacketStats()).averagePacketRate; }
      finally { input.dispose(); }
    };
    return { source: await rate(source.blob), reference: await rate(reference), originalAssetId: project.source.originalAssetId };
  });
  expect(rates).toEqual({ source: 25, reference: 24, originalAssetId: undefined });
});

test('cancelling a fallback conversion preserves the active project and leaves no partial assets', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled();
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.getByRole('button', { name: 'Add video', exact: true })).toBeEnabled();
  const before = await page.evaluate(async () => {
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    return readActiveProject();
  });
  const cancelled = await page.evaluate(async bytes => {
    const { prepareVideo } = await import('/src/media/prepareVideo.ts' as string);
    const operation = new AbortController();
    const encode = VideoEncoder.prototype.encode;
    VideoEncoder.prototype.encode = function (...args) { encode.apply(this, args); operation.abort(); };
    try {
      await prepareVideo(new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), operation.signal, () => undefined);
      return false;
    } catch { return operation.signal.aborted; }
    finally { VideoEncoder.prototype.encode = encode; }
  }, Array.from(await readFile('tests/fixtures/interstitial-reference.mp4')));
  expect(cancelled).toBe(true);
  const result = await page.evaluate(async () => {
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    const project = await readActiveProject();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sparko-projects'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const count = await new Promise<number>(resolve => { const request = db.transaction('assets').objectStore('assets').count(); request.onsuccess = () => resolve(request.result); });
      return { id: project.id, source: project.source, count };
    } finally { db.close(); }
  });
  expect(result).toEqual({ id: before.id, source: before.source, count: 1 });
  await expect(page.locator('.menu-document')).toHaveText('interstitial-reference.mp4');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('normalizes variable frame spacing even when its average is 24 fps', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, CanvasSource, EncodedPacketSink } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { prepareVideo } = await import('/src/media/prepareVideo.ts' as string);
    const canvas = new OffscreenCanvas(160, 90), ctx = canvas.getContext('2d')!;
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    const video = new CanvasSource(canvas, { codec: 'avc', fullCodecString: 'avc1.42001e', bitrate: 100_000 }); output.addVideoTrack(video); await output.start();
    let time = 0;
    for (const duration of [1 / 48, 3 / 48, 1 / 48, 3 / 48]) {
      ctx.fillStyle = '#123456'; ctx.fillRect(0, 0, 160, 90); await video.add(time, duration); time += duration;
    }
    video.close(); await output.finalize();
    const original = new Blob([output.target.buffer], { type: 'video/mp4' });
    const signal = new AbortController().signal;
    const prepared = await prepareVideo(original, signal, () => undefined);
    const input = new Input({ source: new BlobSource(prepared), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack(); const packets = [];
      for await (const packet of new EncodedPacketSink(track).packets()) packets.push({ time: packet.timestamp, duration: packet.duration });
      return { converted: prepared !== original, reused: await prepareVideo(prepared, signal, () => undefined) === prepared, packets };
    } finally { input.dispose(); }
  });
  expect(result.converted).toBe(true); expect(result.reused).toBe(true);
  expect(result.packets.length).toBeGreaterThan(0);
  result.packets.forEach((packet, index) => { expect(packet.time).toBeCloseTo(index / 24, 5); expect(packet.duration).toBeCloseTo(1 / 24, 5); });
});

test('opens a saved 25 fps source without moving its drafts', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled();
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.getByRole('button', { name: 'Add video', exact: true })).toBeEnabled();
  const legacy = await page.evaluate(async () => {
    const { readActiveProject, writeProject } = await import('/src/features/project/database.ts' as string);
    const saved = await readActiveProject();
    const project = { ...saved, id: 'project:legacy', name: 'legacy.mp4', storyFlow: undefined, saved: true, source: { name: 'legacy.mp4', assetId: saved.source.assetId },
      interstitials: [{ id: 'legacy-draft', label: 'Opening', time: 2, start_range: 2, end_range: 2, prompt: 'Keep this scene', phase: 'draft' }] };
    await writeProject(project); return project;
  });
  await page.reload();
  await page.getByRole('region', { name: 'Recent projects' }).getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.menu-document')).toHaveText('legacy.mp4');
  await expect(page.locator('.story-clip-title').filter({ hasText: 'Opening' })).toBeVisible();
  const prepared = await page.evaluate(async () => {
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    const { Input, BlobSource, ALL_FORMATS } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const project = await readActiveProject();
    const input = new Input({ source: new BlobSource((await readAsset(project.source.assetId)).blob), formats: ALL_FORMATS });
    try { return { project, fps: (await (await input.getPrimaryVideoTrack()).computePacketStats()).averagePacketRate }; }
    finally { input.dispose(); }
  });
  expect(prepared.fps).toBeCloseTo(25, 5);
  expect(prepared.project.source.assetId).toBe(legacy.source.assetId);
  expect(prepared.project.source.originalAssetId).toBeUndefined();
  expect(prepared.project.interstitials).toMatchObject(legacy.interstitials);
  expect(prepared.project.interstitials[0].duration).toBe(6);
  await page.locator('.story-clip-title').filter({ hasText: 'Opening' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Duration', exact: true })).toHaveValue('6');
  await expect(page.getByRole('checkbox', { name: 'Prompt expansion', exact: true })).toHaveCount(0);
});

test('prepares a large source at the configured height limit while preserving aspect ratio and the 24 fps clock', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, CanvasSource } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { prepareVideo, prepareSourceVideo } = await import('/src/media/prepareVideo.ts' as string);
    const canvas = new OffscreenCanvas(1920, 1440), ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#123456'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 1_000_000 });
    output.addVideoTrack(video, { frameRate: 25 }); await output.start();
    for (let frame = 0; frame < 50; frame++) await video.add(frame / 25, 1 / 25);
    video.close(); await output.finalize();
    const progress: number[] = [];
    const original = new Blob([output.target.buffer], { type: 'video/mp4' }), signal = new AbortController().signal;
    const normalized = await prepareSourceVideo(original, signal, () => undefined, true);
    const normalInput = new Input({ source: new BlobSource(normalized), formats: ALL_FORMATS });
    let normalizedSize;
    try { const track = await normalInput.getPrimaryVideoTrack(); normalizedSize = [await track.getDisplayWidth(), await track.getDisplayHeight()]; }
    finally { normalInput.dispose(); }
    const reused = await prepareSourceVideo(normalized, signal, () => undefined, true) === normalized;
    const blob = await prepareVideo(original, signal, (value: number) => progress.push(value));
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      return { width: await track.getDisplayWidth(), height: await track.getDisplayHeight(), fps: (await track.computePacketStats()).averagePacketRate, progress, normalizedSize, reused };
    } finally { input.dispose(); }
  });
  expect(result).toMatchObject({ width: 1792, height: 1344 });
  expect(result.normalizedSize).toEqual([1920, 1440]); expect(result.reused).toBe(true);
  expect(result.fps).toBeCloseTo(24, 5);
  expect(result.progress[0]).toBe(0);
  expect(result.progress.length).toBeLessThanOrEqual(101);
  expect(new Set(result.progress).size).toBe(result.progress.length);
});
