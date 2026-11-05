import { test, expect, readProject, saveAndReopen, addDraft, openVideo, fitAll, type Page } from './fixtures';

async function imageFile(page: Page, name = 'Still.png', color = '#00ff00') {
  const bytes = await page.evaluate(async color => {
    const canvas = new OffscreenCanvas(320, 180), context = canvas.getContext('2d')!;
    context.fillStyle = color; context.fillRect(0, 0, 320, 180);
    return Array.from(new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }, color);
  return { name, mimeType: 'image/png', buffer: Buffer.from(bytes) };
}
const workspaceBounds = (page: Page) => page.evaluate(() => ['.video-stage', '.story-canvas', '.sidebar'].map(selector => {
  const r = document.querySelector(selector)!.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height };
}));

for (const width of [1440, 390]) test(`still image import, duration, playback and loading layout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await page.getByRole('button', { name: /^New project/ }).click();
  await expect(page.locator('.story-scroll')).toBeVisible();
  const file = await imageFile(page), idle = await workspaceBounds(page);
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    window.createImageBitmap = async (...args: any[]) => {
      window.createImageBitmap = original;
      await new Promise<void>(resolve => { (window as any).releaseImageImport = resolve; });
      return (original as any)(...args);
    };
  });
  await page.getByLabel('Import videos onto timeline', { exact: true }).setInputFiles(file);
  await expect(page.locator('.project-status')).toBeVisible();
  expect(await workspaceBounds(page)).toEqual(idle);
  await page.screenshot({ path: `test-results/still-import-loading-${width}.png`, fullPage: true });
  await page.evaluate(() => (window as any).releaseImageImport());
  await expect(page.locator('.project-status')).toHaveCount(0);
  await expect(page.locator('.story-clip')).toHaveCount(1);
  expect(await workspaceBounds(page)).toEqual(idle);
  await page.locator('.story-clip-title').click();
  const duration = page.getByLabel('Image duration', { exact: true });
  await expect(duration).toHaveValue('4'); await duration.fill('9.5'); await duration.press('Tab');
  await expect.poll(async () => (await readProject(page)).storyFlow.nodes[0].source.outFrame).toBe(228);
  await expect(page.locator('.story-clip .video-filmstrip img')).toBeVisible();
  await expect(page.locator('.playback-canvas')).toHaveAttribute('data-layer-count', '1');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect(page.locator('.story-filmstrip')).not.toHaveAttribute('aria-valuenow', '0');
  await page.locator('.video-stage').hover(); await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const filmstrip = page.locator('.story-filmstrip'); await filmstrip.press('End');
  await expect(filmstrip).toHaveAttribute('aria-valuenow', String(227 / 24));
  // One held frame remains valid beyond the image's default duration and has no audio.
  const decoded = await page.evaluate(async () => {
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    const { assets } = await import('/src/features/project/assets.ts' as string);
    const { FrameDecoder } = await import('/src/features/player/FrameDecoder.ts' as string);
    const project = await readActiveProject(), id = project.storyFlow.nodes[0].source.assetId;
    const { url } = await assets.open(id), decoder = new FrameDecoder({ id, name: 'Still', url, kind: 'image' }, 0, 48000);
    try {
      for (let i = 0; i < 200 && !decoder.at(0); i++) await new Promise(r => setTimeout(r, 10));
      const first = decoder.at(0), last = decoder.at(1000), canvas = new OffscreenCanvas(1, 1), context = canvas.getContext('2d')!;
      last.drawWithFit(context, { fit: 'contain' });
      return { same: first === last, hasAudio: decoder.hasAudio, audio: decoder.audio.length, color: [...context.getImageData(0, 0, 1, 1).data] };
    } finally { decoder.dispose(); }
  });
  expect(decoded).toMatchObject({ same: true, hasAudio: false, audio: 0 }); expect(decoded.color[1]).toBeGreaterThan(240);
  await page.screenshot({ path: `test-results/still-ready-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if (width === 1440) {
    await saveAndReopen(page); await page.locator('.story-clip-title').click();
    await expect(page.getByLabel('Image duration', { exact: true })).toHaveValue('9.5');
    await expect(page.locator('.playback-canvas')).toHaveAttribute('data-layer-count', '1');
    await page.getByRole('button', { name: 'Library asset Still.png', exact: true }).dblclick();
    await expect(page.locator('.story-clip')).toHaveCount(2);
    expect((await readProject(page)).storyFlow.nodes[1].source.kind).toBe('image');
  }
  const beforeFailure = await workspaceBounds(page), projectBeforeFailure = await readProject(page);
  await page.getByLabel('Import videos onto timeline', { exact: true }).setInputFiles({ name: 'Broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') });
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.locator('.project-status')).toHaveCount(0);
  expect(await workspaceBounds(page)).toEqual(beforeFailure); expect(await readProject(page)).toEqual(projectBeforeFailure);
  expect(errors).toEqual([]);
});

test('encodes ordered mixed references with exact windows and silent image sections', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Input, BlobSource, ALL_FORMATS, CanvasSink, AudioSampleSink, AudioSample, AudioSampleSource } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { assets } = await import('/src/features/project/assets.ts' as string);
    const { createNode, edge } = await import('/src/features/story-flow/model.ts' as string);
    const { storyDependency } = await import('/src/features/story-flow/dependencies.ts' as string);
    const { ensureAac } = await import('/src/media/media.ts' as string); await ensureAac();
    const { generationSource } = await import('/src/features/call-response/generation.ts' as string);
    const canvas = new OffscreenCanvas(320, 192), context = canvas.getContext('2d')!;
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat() });
    const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 300_000 });
    output.addVideoTrack(video, { frameRate: 24 });
    const audioSource = new AudioSampleSource({ codec: 'aac', bitrate: 96_000 }); output.addAudioTrack(audioSource);
    await output.start(); context.fillStyle = '#ff0000'; context.fillRect(0, 0, 320, 192);
    for (let frame = 0; frame < 48; frame++) await video.add(frame / 24, 1 / 24);
    const tone = new Float32Array(96_000); for (let i = 0; i < tone.length; i++) tone[i] = .2 * Math.sin(2 * Math.PI * 440 * i / 48000);
    const audioSample = new AudioSample({ data: tone, format: 'f32-planar', numberOfChannels: 1, sampleRate: 48000, timestamp: 0 });
    await audioSource.add(audioSample); audioSample.close(); audioSource.close(); video.close(); await output.finalize();
    const red = await assets.save(new Blob([output.target.buffer], { type: 'video/mp4' }), 'Red.mp4');
    const picture = async (color: string, name: string) => { context.fillStyle = color; context.fillRect(0, 0, 320, 192); return assets.save(await canvas.convertToBlob({ type: 'image/png' }), name); };
    const green = await picture('#00ff00', 'Green.png'), blue = await picture('#0000ff', 'Blue.png');
    const node = (id: string, asset: any, image = false) => ({ id, name: asset.name, x: 0, y: 0, kind: 'source', loopCount: 0,
      source: { assetId: asset.id, inFrame: 0, outFrame: 48, ...(image ? { kind: 'image' } : {}) } });
    const a = node('red', red), b = node('green', green, true), c = node('blue', blue, true), d = node('red-again', red);
    const generated = createNode('simple'), item = { ...generated.item, start_range: 4, end_range: 4, startReferenceType: 'video', endReferenceType: 'video' };
    const graph = { version: 1, entryId: a.id, nodes: [a, b, generated.node, c, d], edges: [edge(a.id, b.id), edge(b.id, generated.node.id), edge(generated.node.id, c.id), edge(c.id, d.id)], templates: [] };
    const dependency = storyDependency(graph, [item], '', 0, item.id);
    if (dependency.blocked) throw new Error(dependency.blocked);
    const prepared = await generationSource(item, dependency.reference, new AbortController().signal, { width: 320, height: 192 });
    const blob = await prepared.engine.exportMp4({ start: 0, end: 8 });
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack(), sink = new CanvasSink(track, { width: 320, height: 192, fit: 'contain' });
      const colors = [];
      for (const time of [1, 3, 5, 7]) { const sample = await sink.getCanvas(time); colors.push([...sample.canvas.getContext('2d').getImageData(160, 96, 1, 1).data].slice(0, 3)); }
      const peaks = [0, 0, 0, 0];
      for await (const sample of new AudioSampleSink(audio).samples()) {
        try { const data = new Float32Array(sample.numberOfFrames); sample.copyTo(data, { planeIndex: 0, format: 'f32-planar' }); for (let i = 0; i < data.length; i++) { const time = sample.timestamp + i / sample.sampleRate;
          const window = [1, 3, 5, 7].findIndex(center => Math.abs(time - center) < .1); if (window >= 0) peaks[window] = Math.max(peaks[window], Math.abs(data[i])); } }
        finally { sample.close(); }
      }
      return { duration: await track.computeDuration(), colors, peaks, time: prepared.item.time, count: (await track.computePacketStats()).packetCount };
    } finally { input.dispose(); }
  });
  expect(result.duration).toBeCloseTo(8, 4); expect(result.time).toBe(4); expect(result.peaks[0]).toBeGreaterThan(.1); expect(result.peaks[3]).toBeGreaterThan(.1);
  expect(result.peaks[1]).toBeLessThan(.001); expect(result.peaks[2]).toBeLessThan(.001);
  expect(result.colors.map(color => color.map(value => value > 200))).toEqual([[true, false, false], [false, true, false], [false, false, true], [true, false, false]]);
});

for (const width of [1440, 390]) test(`chooses and reorders multiple image references independently for Start and End at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.goto('/'); await page.getByRole('button', { name: /^New project/ }).click(); await addDraft(page);
  const start = page.getByRole('group', { name: 'Start reference', exact: true });
  await start.getByRole('button', { name: 'Video', exact: true }).click();
  await start.getByRole('checkbox', { name: 'Use arbitrary start video' }).check();
  const first = await imageFile(page, 'First.png'), second = await imageFile(page, 'Second.png', '#0000ff');
  await page.getByLabel('Upload Start video', { exact: true }).setInputFiles([first, second]);
  await expect(start.locator('.reference-sequence-clip')).toHaveCount(2);
  await page.getByLabel('Start First.png duration', { exact: true }).fill('2');
  await page.getByLabel('Move Second.png earlier', { exact: true }).click();
  await expect.poll(async () => (await readProject(page)).interstitials[0].startVideoAssets?.map((r: any) => r.name)).toEqual(['Second.png', 'First.png']);
  expect((await readProject(page)).interstitials[0].startVideoAssets[1].outFrame).toBe(48);
  const end = page.getByRole('group', { name: 'End reference', exact: true });
  await end.getByRole('button', { name: 'Video', exact: true }).click(); await end.getByRole('checkbox', { name: 'Use arbitrary end video' }).check();
  const ids = (await readProject(page)).interstitials[0].startVideoAssets.map((r: any) => r.assetId);
  const dataTransfer = await page.evaluateHandle(ids => {
    const data = new DataTransfer(); data.effectAllowed = 'copyMove';
    data.setData('application/x-sparko-library-items', JSON.stringify(ids.map((id: string) => ({ type: 'asset', id })))); return data;
  }, ids);
  await end.getByRole('group', { name: 'End video', exact: true }).dispatchEvent('drop', { dataTransfer });
  await expect(end.locator('.reference-sequence-clip')).toHaveCount(2);
  expect((await readProject(page)).interstitials[0].startVideoAssets).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `test-results/reference-sequence-${width}.png`, fullPage: true });
});

test('opens an image directly as a silent timeline source', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles(await imageFile(page, 'Opening.png'));
  await expect(page.locator('.story-clip')).toHaveCount(1);
  await expect(page.locator('.playback-canvas')).toHaveAttribute('data-layer-count', '1');
  const project = await readProject(page);
  expect(project.storyFlow.nodes[0].source).toMatchObject({ kind: 'image', inFrame: 0, outFrame: 96 });
  expect(project.library[0].kind).toBe('image'); expect(project.library[0].duration).toBeUndefined();
});

test('Preview seeks and plays across a video-to-image connection', async ({ page }) => {
  await openVideo(page);
  await page.getByLabel('Import videos onto timeline', { exact: true }).setInputFiles(await imageFile(page));
  await expect(page.locator('.story-clip')).toHaveCount(2);
  const project = await readProject(page), [video, still] = project.storyFlow.nodes;
  await fitAll(page);
  await page.locator(`[data-node-id="${video.id}"] .story-port.output`).dragTo(page.locator(`[data-node-id="${still.id}"] .story-port.input`));
  await expect.poll(async () => (await readProject(page)).storyFlow.edges.length).toBe(1);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const seek = page.getByRole('slider', { name: 'Seek video', exact: true }), end = video.source.outFrame / 24;
  await seek.fill(String(end + .5));
  await expect(page.locator('.preview-chapter')).toContainText('Still.png');
  await expect(page.locator('.buffering')).toHaveCount(0);
  const pixels = await page.locator('.playback-canvas').screenshot();
  const color = await page.evaluate(async bytes => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(1, 1), context = canvas.getContext('2d')!;
    context.drawImage(image, Math.floor(image.width / 4), Math.floor(image.height / 4), 1, 1, 0, 0, 1, 1); image.close();
    return [...context.getImageData(0, 0, 1, 1).data];
  }, Array.from(pixels));
  expect(color[1]).toBeGreaterThan(240); expect(color[0]).toBeLessThan(10);
  await seek.fill(String(end - .1)); await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(end + .1);
  await expect(page.locator('.preview-chapter')).toContainText('Still.png');
  await page.locator('.video-stage').hover(); await page.getByRole('button', { name: 'Pause', exact: true }).click();
});
