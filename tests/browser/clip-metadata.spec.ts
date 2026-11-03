import { readFile } from 'node:fs/promises';
import { test, expect, readProject, saveAndReopen, fitAll, type Page } from './fixtures';
import { writeClipMetadata, readClipMetadata } from '../../src/media/clipMetadata';
import { clipMetadata } from '../fixtures/clip-metadata';

async function video() {
  const blob = await writeClipMetadata(new Blob([await readFile('tests/fixtures/interstitial-reference.mp4')], { type: 'video/mp4' }), clipMetadata, new AbortController().signal);
  return Buffer.from(await blob.arrayBuffer());
}
async function drop(page: Page, bytes: Buffer) {
  const dataTransfer = await page.evaluateHandle(bytes => { const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(bytes)], 'portable.mp4', { type: 'video/mp4' })); return data; }, [...bytes]);
  await page.locator('.story-scroll').dispatchEvent('drop', { dataTransfer, clientX: 150, clientY: 180 });
  await dataTransfer.dispose();
}
for (const width of [1440, 390]) test(`dropping a portable video restores an interstitial and keeps loading layout stable at ${width}px`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 1000 }); await page.goto('/');
  await page.getByRole('button', { name: /^New project/ }).click(); await expect(page.locator('.story-scroll')).toBeVisible();
  const positions = () => page.locator('.story-toolbar,.library-toolbar,.library-filter').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  const before = await positions();
  await page.evaluate(() => {
    (window as any).importPositions = [];
    const observer = new MutationObserver(() => { if (document.querySelector('.project-status')) {
      (window as any).importPositions.push([...document.querySelectorAll('.story-toolbar,.library-toolbar,.library-filter')].map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    } }); observer.observe(document.body, { childList: true, subtree: true }); (window as any).importObserver = observer;
  });
  const bytes = await video(); await drop(page, bytes);
  await expect(page.locator('.story-clip.type-simple')).toHaveCount(1); await expect(page.locator('.project-status')).toHaveCount(0);
  const during = await page.evaluate(() => { (window as any).importObserver.disconnect(); return (window as any).importPositions; });
  expect(during.length).toBeGreaterThan(0); for (const position of during) expect(position).toEqual(before);
  expect(await positions()).toEqual(before);
  const project = await readProject(page); expect(project.interstitials[0]).toMatchObject({ phase: 'ready', generationSettings: { ...clipMetadata.settings, maskInjection: 'standard' }, result: { metadata: clipMetadata, start: 1, duration: 2, totalDuration: 4 } });
  expect(project.interstitials[0].requestId).toBeUndefined(); expect(project.storyFlow.nodes[0].source).toBeUndefined();
  await fitAll(page); await page.locator('.story-clip-title').click();
  await expect(page.getByLabel('Video prompt', { exact: true })).toHaveValue(clipMetadata.settings.prompt);
  await page.locator('.inspector-output>summary').click();
  await expect(page.getByRole('region', { name: 'Video breakdown' })).toContainText('Opening video');
  await expect(page.getByRole('region', { name: 'Video breakdown' })).toContainText('Ending video');
  await expect(page.getByRole('region', { name: 'Video breakdown' })).toContainText('Original clip is not in this project');
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download full video' }).click();
  const download = await downloadEvent, saved = await readClipMetadata(new Blob([await readFile((await download.path())!)]), new AbortController().signal);
  expect(saved).toEqual(clipMetadata);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('.story-clip')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(page.locator('.story-clip.type-simple')).toHaveCount(1);
  await page.getByRole('button', { name: 'Library asset Across the doorway', exact: true }).dblclick();
  await expect(page.locator('.story-clip.type-simple')).toHaveCount(2);
  const duplicate = await readProject(page); expect(new Set(duplicate.interstitials.map((i: any) => i.id)).size).toBe(2);
  expect(new Set(duplicate.interstitials.map((i: any) => i.result.assetId)).size).toBe(1);
  await saveAndReopen(page); await expect(page.locator('.story-clip.type-simple')).toHaveCount(2);
  expect((await readProject(page)).interstitials.every((i: any) => i.result.metadata.references.before.name === 'Opening video')).toBe(true);
  expect(errors).toEqual([]);
});

test('opening a portable video directly restores it; ordinary and invalid metadata files remain sources', async ({ page }) => {
  await page.goto('/'); await page.getByLabel('Choose video file', { exact: true }).setInputFiles({ name: 'portable.mp4', mimeType: 'video/mp4', buffer: await video() });
  await expect(page.locator('.story-clip.type-simple')).toHaveCount(1);
  await page.getByLabel('Import videos onto timeline', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.story-clip.type-source')).toHaveCount(1);
  const unknownVersion = await video(), offset = unknownVersion.indexOf('"version":1');
  expect(offset).toBeGreaterThan(0); unknownVersion.write('2', offset + '"version":'.length);
  await page.getByLabel('Import videos onto timeline', { exact: true }).setInputFiles({ name: 'future-version.mp4', mimeType: 'video/mp4', buffer: unknownVersion });
  await expect(page.locator('.story-clip.type-source')).toHaveCount(2);
  expect((await readProject(page)).interstitials).toHaveLength(1);
});

test('metadata preserves real AAC audio and H.264 video packets and survives loop extraction', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async metadata => {
    const { Output, BufferTarget, Mp4OutputFormat, CanvasSource, AudioBufferSource, Input, BlobSource, ALL_FORMATS, EncodedPacketSink } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { ensureAac } = await import('/src/media/media.ts' as string); await ensureAac();
    const { writeClipMetadata, readClipMetadata } = await import('/src/media/clipMetadata.ts' as string);
    const { finishLoop } = await import('/src/features/call-response/finishLoop.ts' as string);
    const canvas = new OffscreenCanvas(160, 96), ctx = canvas.getContext('2d')!;
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory', metadataFormat: 'mdta' }) });
    output.setMetadataTags({ raw: { prompt: '{"noise":{"inputs":{"noise_seed":1234}}}' } });
    const video = new CanvasSource(canvas, { codec: 'avc', fullCodecString: 'avc1.42001e', bitrate: 100_000 });
    const audio = new AudioBufferSource({ codec: 'aac', bitrate: 64_000 });
    output.addVideoTrack(video, { frameRate: 24 }); output.addAudioTrack(audio); await output.start();
    await Promise.all([(async () => { for (let frame = 0; frame < 96; frame++) { ctx.fillStyle = '#00ee00'; ctx.fillRect(0, 0, 160, 96); await video.add(frame / 24, 1 / 24); } video.close(); })(),
      (async () => { const buffer = new AudioBuffer({ numberOfChannels: 1, length: 4 * 48000, sampleRate: 48000 }); const samples = buffer.getChannelData(0); for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 48000 * Math.PI * 880) * 0.1; await audio.add(buffer); audio.close(); })()]);
    await output.finalize(); const original = new Blob([output.target.buffer], { type: 'video/mp4' }), signal = new AbortController().signal;
    const tagged = await writeClipMetadata(original, metadata, signal);
    const inspect = async (blob: Blob) => {
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      try { const tracks = []; for (const track of await input.getTracks()) { const packets = []; for await (const p of new EncodedPacketSink(track).packets()) packets.push({ timestamp: p.timestamp, duration: p.duration, data: [...p.data] }); tracks.push({ codec: await track.getCodec(), packets }); } return { tracks, tags: await input.getMetadataTags() }; }
      finally { input.dispose(); }
    };
    const before = await inspect(original), after = await inspect(tagged);
    const loop = await finishLoop(tagged, { url: '', ...metadata.media, metadata }, signal);
    const loopInfo = await inspect(loop.blob);
    return { same: JSON.stringify(before.tracks) === JSON.stringify(after.tracks), codecs: after.tracks.map(t => t.codec), comfy: after.tags.raw.prompt,
      metadata: await readClipMetadata(tagged, signal), loop: await readClipMetadata(loop.blob, signal), loopComfy: loopInfo.tags.raw.prompt };
  }, clipMetadata);
  expect(result.same).toBe(true); expect(result.codecs).toEqual(['avc', 'aac']); expect(result.metadata).toEqual(clipMetadata);
  expect(result.loop.media).toEqual({ start: 0, duration: 2, totalDuration: 2 }); expect(result.loopComfy).toBe(result.comfy);
});
