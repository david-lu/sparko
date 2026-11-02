import { expect, test, openVideo, addBridge, saveAndReopen, type Page } from './fixtures';


async function generatedFixture(page: Page) {
  const bytes = await page.evaluate(async () => {
    const { Output, BufferTarget, Mp4OutputFormat, CanvasSource, AudioBufferSource } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { ensureAac } = await import('/src/media/media.ts' as string); await ensureAac();
    const canvas = new OffscreenCanvas(160, 90), ctx = canvas.getContext('2d')!;
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 100_000 });
    const audio = new AudioBufferSource({ codec: 'aac', bitrate: 128_000 });
    output.addVideoTrack(video, { frameRate: 25 }); output.addAudioTrack(audio); await output.start();
    await Promise.all([(async () => { for (let frame = 0; frame < 225; frame++) { ctx.fillStyle = frame >= 50 && frame < 175 ? '#00ee00' : '#ee0000'; ctx.fillRect(0, 0, 160, 90); await video.add(frame / 25, 1 / 25); } video.close(); })(),
      (async () => { const buffer = new AudioBuffer({ numberOfChannels: 2, length: 9 * 48000, sampleRate: 48000 }); for (let channel = 0; channel < 2; channel++) { const samples = buffer.getChannelData(channel); for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 48000 * Math.PI * 880) * 0.1; } await audio.add(buffer); audio.close(); })()]);
    await output.finalize(); return [...new Uint8Array(output.target.buffer)];
  });
  const buffer = Buffer.from(bytes);
  await page.route('https://example.test/interstitial-fixture.mp4', route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), buffer.length - 1) : buffer.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4', headers: { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${buffer.length}` } : {}) }, body: buffer.subarray(start, end + 1) });
  });
  return buffer;
}
test('reference and duration sliders synchronize with inputs and persist', async ({ page }) => {
  await page.route('**/api/status', async route => { const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { comfy: true } } }); });
  await openVideo(page); await addBridge(page);
  await page.getByRole('checkbox', { name: 'Use end reference', exact: true }).check();
  await page.getByLabel('Interstitial prompt').fill('A green interstitial scene');
  for (const [name, label, value] of [['start_range', 'Start footage', '1.8'], ['end_range', 'End footage', '1.7'], ['Duration', 'Duration', '7.5']]) {
    const number = page.getByRole('spinbutton', { name, exact: true });
    await number.click(); const slider = page.getByRole('slider', { name: `${label} slider`, exact: true });
    await slider.fill(value); await expect(number).toHaveValue(value);
    await number.fill('2'); await expect(slider).toHaveValue('2');
    await number.fill(value); await slider.press('Escape');
    await expect(slider).toHaveCount(0); await expect(number).toBeFocused();
  }
  await saveAndReopen(page); await page.locator('.story-clip.type-simple .story-clip-title').click();
  await expect(page.getByLabel('start_range', { exact: true })).toHaveValue('1.8');
  await expect(page.getByLabel('end_range', { exact: true })).toHaveValue('1.7');
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('7.5');
});

test('composition export with crossfades disabled preserves frame counts, generated-only bounds and audio through both cuts', async ({ page }) => {
  await page.goto('/');
  await generatedFixture(page);
  const result = await page.evaluate(async () => {
    const { TimelineComposition } = await import('/src/media/TimelineComposition.ts' as string);
    const { TimelineStream } = await import('/src/media/TimelineStream.ts' as string);
    const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const url = 'https://example.test/interstitial-fixture.mp4';
    const composition = new TimelineComposition({ id: 'source', name: 'Source', url }, { duration: 3, fps: 25, width: 160, height: 90, codec: 'avc', hasAudio: true },
      [{ id: 'insert', label: 'Insert', time: 1, phase: 'ready', result: { url, start: 2, duration: 5, totalDuration: 9 } }], { crossfade: false });
    const blob = await new TimelineStream(composition).exportMp4({ start: 0, end: 8 });
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
      const sink = new CanvasSink(video, { width: 1, height: 1, fit: 'fill' });
      const colors: number[][] = [];
      for (const time of [0.96, 1, 5.96, 6]) { const sample = await sink.getCanvas(time + 1e-7); colors.push([...sample.canvas.getContext('2d').getImageData(0, 0, 1, 1).data]); }
      return { videoDuration: await video.computeDuration(), audioDuration: await audio.computeDuration(), stats: await video.computePacketStats(), colors };
    } finally { input.dispose(); }
  });
  expect(result.videoDuration).toBeCloseTo(8, 3); expect(Math.abs(result.audioDuration - 8)).toBeLessThan(4096 / 48000);
  expect(result.stats.packetCount).toBe(192);
  expect(result.stats.averagePacketRate).toBeCloseTo(24, 5);
  expect(result.colors[0][0]).toBeGreaterThan(180); expect(result.colors[1][1]).toBeGreaterThan(180); expect(result.colors[2][1]).toBeGreaterThan(180); expect(result.colors[3][0]).toBeGreaterThan(180);
});
