import { test, expect, openVideo, addBridge, openGenerationTimeline, closeGenerationTimeline, readProject, fitAll, type Page } from './fixtures';

async function openAudioVideo(page: Page) {
  await page.goto('/');
  const bytes = await page.evaluate(async () => {
    const { Output, BufferTarget, Mp4OutputFormat, CanvasSource, AudioBufferSource } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { ensureAac } = await import('/src/media/media.ts' as string); await ensureAac();
    const canvas = new OffscreenCanvas(160, 90); canvas.getContext('2d')!.fillRect(0, 0, 160, 90);
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat() });
    const video = new CanvasSource(canvas, { codec: 'avc', fullCodecString: 'avc1.42001e', bitrate: 100_000 }), audio = new AudioBufferSource({ codec: 'aac', bitrate: 128_000 });
    output.addVideoTrack(video, { frameRate: 24 }); output.addAudioTrack(audio); await output.start();
    const buffer = new AudioBuffer({ numberOfChannels: 1, sampleRate: 48000, length: 4 * 48000 });
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = i >= 48000 && i < 96000 ? 0 : .6 * Math.sin(i / 48000 * 440 * Math.PI * 2);
    await audio.add(buffer); audio.close();
    for (let frame = 0; frame < 96; frame++) await video.add(frame / 24, 1 / 24);
    video.close(); await output.finalize(); return [...new Uint8Array(output.target.buffer)];
  });
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles({ name: 'Tone and silence.mp4', mimeType: 'video/mp4', buffer: Buffer.from(bytes) });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
}

for (const width of [1440, 390]) test(`generation transport stays independent and story scrubbing survives returning at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page); await addBridge(page);
  const story = page.locator('.story-clip.type-simple .story-filmstrip');
  await story.press('Home'); await story.press('Shift+ArrowRight');
  const before = await story.getAttribute('aria-valuenow');
  const project = await readProject(page);
  const editor = await openGenerationTimeline(page), ruler = editor.getByRole('slider', { name: 'Timeline ruler', exact: true });
  const playhead = editor.getByRole('slider', { name: 'Generation timeline playhead', exact: true });
  await ruler.press('Home');
  await editor.getByRole('button', { name: 'Play timeline', exact: true }).click();
  await expect.poll(async () => Number(await playhead.inputValue())).toBeGreaterThan(5);
  await expect(editor.getByRole('button', { name: 'Pause timeline', exact: true })).toBeVisible();
  await expect(story).toHaveAttribute('aria-valuenow', before!);
  await editor.getByRole('button', { name: 'Pause timeline', exact: true }).click();
  await closeGenerationTimeline(page);
  await expect(story).toHaveAttribute('aria-valuenow', before!);
  await fitAll(page);
  const source = page.locator('.story-clip.type-source .story-filmstrip').first();
  await source.click();
  await expect.poll(async () => Number(await source.getAttribute('aria-valuenow'))).toBeGreaterThan(.1);
  await expect(page.locator('.playback-canvas')).toHaveAttribute('data-layer-count', '1');
  await source.press('Home'); await source.press('Shift+ArrowRight');
  await expect(source).toHaveAttribute('aria-valuenow', '1');
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect.poll(async () => Number(await source.getAttribute('aria-valuenow'))).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Pause', exact: true }).press('Enter');
  expect((await readProject(page)).storyFlow).toEqual(project.storyFlow);
  expect((await readProject(page)).interstitials).toEqual(project.interstitials);
});

test('an interrupted media play request at zero does not cancel generation playback', async ({ page }) => {
  await openVideo(page); await addBridge(page); const editor = await openGenerationTimeline(page);
  await editor.getByRole('slider', { name: 'Timeline ruler', exact: true }).press('Home');
  const media = editor.locator('.generation-player-screen video');
  await expect.poll(() => media.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
  // Reproduce the browser cancelling a pending play when an input seek/load supersedes it.
  await media.evaluate((video: HTMLVideoElement) => {
    const play = video.play.bind(video); let first = true;
    video.play = () => { if (first) { first = false; return Promise.reject(new DOMException('A seek interrupted play', 'AbortError')); } return play(); };
  });
  await editor.getByRole('button', { name: 'Play timeline', exact: true }).click();
  await expect.poll(async () => Number(await editor.getByRole('slider', { name: 'Generation timeline playhead', exact: true }).inputValue())).toBeGreaterThan(6);
  await expect(media).toHaveJSProperty('paused', false);
  await expect(editor.getByRole('button', { name: 'Pause timeline', exact: true })).toBeVisible();
});

for (const width of [1440, 390]) test(`waveforms load without moving controls and support zoomed scrubbing at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await openAudioVideo(page); await addBridge(page);
  await page.evaluate(async () => {
    const { AudioSampleSink } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const original = AudioSampleSink.prototype.samples, gate = new Promise<void>(resolve => { (window as any).releaseWaveform = () => { AudioSampleSink.prototype.samples = original; resolve(); }; });
    AudioSampleSink.prototype.samples = async function* (...args: any[]) { await gate; yield* original.apply(this, args); };
  });
  const editor = await openGenerationTimeline(page), wave = editor.getByRole('slider', { name: 'Audio waveform playhead', exact: true });
  const layout = () => editor.evaluate(root => ['.generation-player', '.generation-timeline-toolbar', '.generation-timeline-scroll', '.generation-selection-panel'].map(selector => { const r = root.querySelector(selector)!.getBoundingClientRect(); return { y: r.y - root.getBoundingClientRect().y, height: r.height }; }));
  await expect(editor.locator('.generation-waveform-clip').first()).toHaveAttribute('data-state', 'loading');
  const loading = await layout(); await page.evaluate(() => (window as any).releaseWaveform());
  await expect(editor.locator('.generation-waveform-clip').first()).toHaveAttribute('data-state', 'ready');
  expect(await layout()).toEqual(loading);
  const path = editor.locator('.generation-waveform-clip svg path').first(); await expect(path).toHaveAttribute('d', /v[1-9]/);
  const levels = await page.evaluate(async () => {
    const { audioWaveform } = await import('/src/features/interstitials/audio-waveform.ts' as string);
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    const assetId = (await readActiveProject()).source.assetId;
    const loud = await audioWaveform({ assetId, sourceFrame: 0, frames: 20 }, new AbortController().signal);
    const quiet = await audioWaveform({ assetId, sourceFrame: 28, frames: 16 }, new AbortController().signal);
    return { loud: Math.max(...loud.peaks), quiet: Math.max(...quiet.peaks), bins: quiet.peaks.length };
  });
  expect(levels.loud).toBeGreaterThan(.4); expect(levels.quiet).toBeLessThan(.01); expect(levels.bins).toBe(64);
  const overview = page.locator('.generation-timeline-summary'); const before = await overview.boundingBox();
  await editor.getByRole('button', { name: 'Zoom in generation timeline', exact: true }).click();
  await expect(editor.getByLabel('Generation timeline zoom', { exact: true })).toHaveValue('2');
  await wave.scrollIntoViewIfNeeded();
  const box = (await wave.boundingBox())!, view = (await editor.locator('.generation-timeline-scroll').boundingBox())!;
  const x = view.x + view.width / 2, y = box.y + box.height / 2;
  const frames = Number(await wave.getAttribute('aria-valuemax')) + 1;
  await page.mouse.click(x, y);
  await expect(wave).toHaveAttribute('aria-valuenow', String(Math.round((x - box.x) / box.width * frames)));
  const anchorBefore = await editor.locator('.generation-cursor-line').boundingBox();
  await wave.dispatchEvent('wheel', { ctrlKey: true, deltaY: -50, clientX: x, clientY: y });
  await expect.poll(async () => Number(await editor.getByLabel('Generation timeline zoom', { exact: true }).inputValue())).toBeGreaterThan(2);
  const anchorAfter = await editor.locator('.generation-cursor-line').boundingBox();
  expect(Math.abs(anchorAfter!.x - anchorBefore!.x)).toBeLessThan(3);
  await wave.press('Home'); await expect(wave).toHaveAttribute('aria-valuenow', '0');
  await wave.press('Shift+ArrowRight'); await expect(wave).toHaveAttribute('aria-valuenow', '10');
  expect(await overview.boundingBox()).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `test-results/generation-waveform-${width}.png` });
});


test('generated audio waveform and playback start at zero independently of input references', async ({ page }) => {
  await openAudioVideo(page); await addBridge(page);
  const bytes = await page.evaluate(async () => {
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    const { packProject } = await import('/src/features/project/archive.ts' as string);
    const project = await readActiveProject(), media = await readAsset(project.source.assetId), item = project.interstitials[0];
    item.phase = 'ready'; item.result = { assetId: media.id, url: 'asset:' + media.id, start: 0, duration: 4, totalDuration: 4 };
    return [...new Uint8Array(await (await packProject(project, [media], new AbortController().signal, () => {})).arrayBuffer())];
  });
  await page.getByLabel('Choose project file', { exact: true }).setInputFiles({ name: 'Waveform.sparko', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await page.locator('.story-clip.type-simple .story-clip-title').click();
  const editor = await openGenerationTimeline(page);
  await editor.getByRole('button', { name: 'Generated', exact: true }).click();
  await expect(editor.getByRole('img', { name: 'Audio waveform of Generated video', exact: true })).toBeVisible();
  const playhead = editor.getByRole('slider', { name: 'Generation timeline playhead', exact: true });
  await playhead.press('Home'); await expect(playhead).toHaveValue('0');
  await editor.getByRole('button', { name: 'Play timeline', exact: true }).click();
  await expect.poll(async () => Number(await playhead.inputValue())).toBeGreaterThan(6);
  await editor.getByRole('button', { name: 'Input', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Play timeline', exact: true })).toBeVisible();
  await expect(editor.getByRole('img', { name: 'Audio waveform of Generated video', exact: true })).toHaveCount(0);
});
