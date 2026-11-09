import { openGenerationTimeline, closeGenerationTimeline, test, expect, readProject, saveAndReopen, addDraft, openVideo, fitAll, type Page } from './fixtures';

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
  await expect(duration).toHaveValue('1');
  await duration.fill('0.001');
  await expect.poll(async () => (await readProject(page)).storyFlow.nodes[0].source.outFrame).toBe(1);
  await expect(duration).toHaveValue(String(1 / 24));
  expect(await duration.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(true);
  await expect(page.locator('.story-clip')).toHaveAttribute('data-duration', String(1 / 24));
  await duration.press('ArrowUp'); await expect(duration).toHaveValue(String(2 / 24));
  await duration.press('ArrowDown'); await duration.press('ArrowDown');
  await expect(duration).toHaveValue(String(1 / 24));
  await duration.fill('0'); await expect(duration).toHaveValue(String(1 / 24));
  await duration.fill('1');
  await page.getByRole('slider', { name: 'Trim end of Still.png', exact: true }).press('Home');
  await expect(duration).toHaveValue(String(1 / 24));
  await page.getByRole('slider', { name: 'Trim end of Still.png', exact: true }).press('ArrowRight');
  await expect(duration).toHaveValue(String(2 / 24));
  await duration.fill('9.5'); await duration.press('Tab');
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

for (const width of [1440, 390]) test(`one-frame clips hide crowded circles while retaining trimming and connections at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page);
  await page.getByLabel('Import videos onto timeline', { exact: true }).setInputFiles(await imageFile(page));
  await expect(page.locator('.story-clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Select Still.png', exact: true }).press('Enter');
  await page.getByRole('slider', { name: 'Trim end of Still.png', exact: true }).press('Home');
  await fitAll(page);
  const [video, still] = (await readProject(page)).storyFlow.nodes;
  expect(still.source.outFrame - still.source.inFrame).toBe(1);
  const imageClip = page.locator(`[data-node-id="${still.id}"]`), videoClip = page.locator(`[data-node-id="${video.id}"]`);
  const circleSizes = () => page.locator('.story-port:visible').evaluateAll(elements => elements.map(el => {
    const bounds = el.getBoundingClientRect(); return { width: bounds.width, height: bounds.height };
  }));
  await expect(imageClip.locator('.story-port:visible')).toHaveCount(0);
  expect(await circleSizes()).toEqual(Array(2).fill({ width: 14, height: 14 }));
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Zoom out story', exact: true }).click();
  await expect(imageClip.locator('.story-port:visible')).toHaveCount(0);
  for(const circle of await circleSizes())expect(circle).toEqual({ width: 14, height: 14 });
  await videoClip.locator('.story-clip-title').click({button:'right'});
  await page.getByRole('menuitem',{name:'Connect to clip…',exact:true}).click();
  await imageClip.locator('.story-clip-title').press('Enter');
  await expect.poll(async () => (await readProject(page)).storyFlow.edges.length).toBe(1);
  await imageClip.locator('.story-clip-title').click({button:'right'});
  await page.getByRole('menuitem',{name:'Connect to clip…',exact:true}).click();
  await videoClip.locator('.story-clip-title').click();
  await expect.poll(async () => (await readProject(page)).storyFlow.edges.length).toBe(2);
  await imageClip.locator('.story-clip-title').press('Enter');
  const handle = page.getByRole('slider', { name: 'Trim end of Still.png', exact: true });
  await expect(handle).toBeVisible();
  await handle.press('ArrowRight'); await expect(page.getByLabel('Image duration', { exact: true })).toHaveValue(String(2 / 24));
  await handle.press('Home'); await expect(page.getByLabel('Image duration', { exact: true })).toHaveValue(String(1 / 24));
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height * .8); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 24, bounds.y + bounds.height * .8, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await readProject(page)).storyFlow.nodes[1].source.outFrame).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Image duration', { exact: true })).toHaveValue(String(1 / 24));
  await videoClip.locator('.story-clip-title').press('Enter');
  await page.getByRole('slider', { name: `Trim end of ${video.name}`, exact: true }).press('Home');
  expect(await circleSizes()).toEqual([]);
  await expect(page.getByRole('slider', { name: `Trim end of ${video.name}`, exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/one-frame-handles-${width}.png`, fullPage: true });
  await saveAndReopen(page);
  const restored = (await readProject(page)).storyFlow;
  expect(restored.edges).toHaveLength(2);
  expect(restored.nodes.map((node: any) => node.source.outFrame - node.source.inFrame)).toEqual([1, 1]);
  expect(await circleSizes()).toEqual([]);
});

for (const width of [1440, 390]) test(`the left image handle extends, shortens, cancels and saves a held frame at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByLabel('Import videos onto timeline', { exact: true }).setInputFiles(await imageFile(page));
  await expect(page.locator('.story-clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Select Still.png', exact: true }).press('Enter');
  await page.getByRole('slider', { name: 'Trim end of Still.png', exact: true }).press('Home');
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  const node = async () => (await readProject(page)).storyFlow.nodes[1], original = await node();
  const right = (node: any) => node.x + (node.source.outFrame - node.source.inFrame) / 24 * 32;
  const handle = page.getByRole('slider', { name: 'Trim start of Still.png', exact: true });
  const scrub = page.getByRole('slider', { name: 'Scrub Still.png', exact: true });
  await scrub.press('Home'); await handle.press('Shift+ArrowLeft');
  await expect.poll(async () => (await node()).source.outFrame).toBe(11);
  expect((await node()).source.inFrame).toBe(0); expect(right(await node())).toBeCloseTo(right(original));
  await expect(handle).toHaveAttribute('aria-valuenow', String(11 / 24));
  await expect(scrub).toHaveAttribute('aria-valuenow', String(10 / 24));
  await handle.press('ArrowRight'); await expect.poll(async () => (await node()).source.outFrame).toBe(10);
  await expect(scrub).toHaveAttribute('aria-valuenow', String(9 / 24));
  await handle.press('End'); await expect.poll(async () => (await node()).source.outFrame).toBe(1);
  expect((await node()).x).toBeCloseTo(original.x);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  const before = await workspaceBounds(page);
  const dragLeft = async (cancel = false) => {
    await handle.scrollIntoViewIfNeeded(); const bounds = (await handle.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height * .8); await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 - 64, bounds.y + bounds.height * .8, { steps: 6 });
    await expect(page.locator('.story-clip.trimming')).toHaveCount(1);
    expect(await workspaceBounds(page)).toEqual(before);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  await dragLeft(); await expect.poll(async () => (await node()).source.outFrame).toBeGreaterThan(1);
  const extended = await node(); expect(extended.x).toBeLessThan(original.x); expect(right(extended)).toBeCloseTo(right(original));
  expect(extended.source.inFrame).toBe(0); expect(await workspaceBounds(page)).toEqual(before);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect.poll(async () => (await node()).source.outFrame).toBe(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect.poll(node).toEqual(extended);
  await dragLeft(true); expect(await node()).toEqual(extended); expect(await workspaceBounds(page)).toEqual(before);
  await saveAndReopen(page); expect((await node()).source).toMatchObject({ kind: 'image', inFrame: 0, outFrame: extended.source.outFrame });
  expect((await node()).x).toBeCloseTo(extended.x);
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

for (const width of [1440, 390]) test(`image keyframe positions and methods stay independent and persist at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.goto('/'); await page.getByRole('button', { name: /^New project/ }).click(); await addDraft(page);
  const editor = await openGenerationTimeline(page);
  for (const [name, frame] of [['First.png', '0'], ['Second.png', '48']]) {
    await editor.getByRole('button', { name: 'Add image keyframe', exact: true }).click();
    await editor.getByLabel('Upload Keyframe image', { exact: true }).setInputFiles(await imageFile(page, name));
    await expect(editor.getByRole('group', { name: 'Keyframe image', exact: true })).toHaveAttribute('aria-busy', 'false');
    await editor.getByLabel('Keyframe frame', { exact: true }).fill(frame);
  }
  await editor.getByLabel('Keyframe method', { exact: true }).selectOption('frame');
  await editor.getByLabel('Selected generation input', { exact: true }).selectOption({ index: 1 });
  await expect(editor.getByLabel('Keyframe frame', { exact: true })).toHaveValue('0');
  await expect(editor.getByLabel('Keyframe method', { exact: true })).toHaveValue('guide');
  await editor.getByLabel('Keyframe frame', { exact: true }).press('ArrowUp'); await expect(editor.getByLabel('Keyframe frame', { exact: true })).toHaveValue('1');
  const frames = (await readProject(page)).interstitials[0].keyframes;
  expect(frames).toMatchObject([{ frame: 1, image: { name: 'First.png' } }, { frame: 48, method: 'frame', image: { name: 'Second.png' } }]);
  await closeGenerationTimeline(page); await saveAndReopen(page);
  const restored = (await readProject(page)).interstitials[0].keyframes;
  expect(restored).toMatchObject(frames.map(({ image, ...frame }: any) => ({ ...frame, image: { name: image.name } })));
  expect(await page.evaluate(async () => {
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    const frames = (await readActiveProject()).interstitials[0].keyframes;
    return Promise.all(frames.map(async (frame: any) => (await readAsset(frame.image.assetId))?.blob.size > 0));
  })).toEqual([true, true]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('opens an image directly as a silent timeline source', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles(await imageFile(page, 'Opening.png'));
  await expect(page.locator('.story-clip')).toHaveCount(1);
  await expect(page.locator('.playback-canvas')).toHaveAttribute('data-layer-count', '1');
  const project = await readProject(page);
  expect(project.storyFlow.nodes[0].source).toMatchObject({ kind: 'image', inFrame: 0, outFrame: 24 });
  expect(project.library[0].kind).toBe('image'); expect(project.library[0].duration).toBeUndefined();
});

test('Preview seeks and plays across a video-to-image connection', async ({ page }) => {
  await openVideo(page);
  await page.getByLabel('Import videos onto timeline', { exact: true }).setInputFiles(await imageFile(page));
  await expect(page.locator('.story-clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Select Still.png', exact: true }).click();
  await page.getByLabel('Image duration', { exact: true }).fill('4');
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
