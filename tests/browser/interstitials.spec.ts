import { expect, test, type Page } from './fixtures';


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
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('sparko:interstitials:v1:default:sample.mp4') || '[]'));
async function openTimeSlider(page: Page, label: string) {
  const name = label === 'Start range' ? 'start_range' : label === 'End range' ? 'end_range' : 'Duration';
  await page.getByRole('spinbutton', { name, exact: true }).click();
  return page.getByRole('slider', { name: `${label} slider`, exact: true });
}
async function addDraft(page: Page, time = 5) {
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill(String(time));
  await page.getByRole('button', { name: 'Add regular interstitial' }).click();
  await page.getByRole('textbox', { name: 'Interstitial name', exact: true }).fill(`Interstitial ${await page.locator('.timeline-pin').count()}`);
  await page.getByRole('textbox', { name: 'Interstitial name', exact: true }).press('Enter');
  await expect(page.getByLabel('start_range')).toHaveValue('2');
  await expect(page.getByLabel('end_range')).toHaveValue('2');
  await page.getByLabel('Interstitial prompt').fill('A green interstitial scene');
}
test.beforeEach(async ({ page }) => {
  await page.route('**/api/status', async route => { const response = await route.fetch(); const status = await response.json(); await route.fulfill({ json: { ...status, providers: { ...status.providers, comfy: true } } }); });
  await page.goto('/');
  await page.getByRole('button', { name: /Sample video/ }).click();
  await expect(page.getByRole('button', { name: 'Add regular interstitial' })).toBeEnabled({ timeout: 60_000 });
});

test('time sliders and number inputs stay synchronized and survive reopening a draft', async ({ page }) => {
  await addDraft(page);
  await expect(page.locator('.video-stage video')).toHaveJSProperty('paused', true);
  await expect(page.getByRole('spinbutton', { name: 'Duration', exact: true })).toHaveValue('6');
  await expect(page.locator('.interstitial-time-popover')).toHaveCount(0);
  await page.getByRole('separator', { name: 'Resize side panel' }).press('Home');
  const fields = await page.locator('.interstitial-time-field').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().y));
  expect(new Set(fields).size).toBe(1);
  for (const [sliderName, inputName, fromSlider, fromNumber] of [
    ['Start range slider', 'start_range', '1.625', '3.51'],
    ['End range slider', 'end_range', '1.625', '2.54'],
    ['Duration slider', 'Duration', '13', '7.33'],
  ]) {
    const slider = await openTimeSlider(page, sliderName.replace(' slider', ''));
    const number = page.getByRole('spinbutton', { name: inputName, exact: true });
    await expect(page.locator('.interstitial-time-popover')).toHaveCount(1);
    const popup = (await page.locator('.interstitial-time-popover').boundingBox())!;
    const sidebar = (await page.locator('.sidebar').boundingBox())!;
    expect(popup.x).toBeGreaterThanOrEqual(sidebar.x);
    expect(popup.x + popup.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
    await slider.fill(fromSlider); await expect(number).toHaveValue(fromSlider);
    await number.fill(fromNumber); await expect(slider).toHaveValue(fromNumber);
  }
  const duration = page.getByRole('spinbutton', { name: 'Duration', exact: true });
  const slider = page.getByRole('slider', { name: 'Duration slider', exact: true });
  await slider.press('ArrowRight'); await expect(duration).toHaveValue('7.58');
  for (const invalid of ['', '4', '14']) {
    await duration.fill(invalid);
    await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
    await expect(page.getByRole('alert')).toHaveText('Duration must be between 5 and 13 seconds.');
  }
  await duration.fill('7.5'); await expect(slider).toHaveValue('7.5');
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
  await slider.press('Escape'); await expect(page.locator('.interstitial-time-popover')).toHaveCount(0);
  await expect(duration).toBeFocused();
  await duration.click(); await expect(slider).toBeVisible();
  await page.getByLabel('Interstitial prompt').click(); await expect(page.locator('.interstitial-time-popover')).toHaveCount(0);
  await expect.poll(async () => (await saved(page))[0]).toMatchObject({ start_range: 3.51, end_range: 2.54, duration: 7.5, enable_prompt_expansion: false });
  await page.getByRole('button', { name: 'All interstitials' }).click();
  await page.getByRole('button', { name: 'Select Interstitial 1', exact: true }).click();
  await expect(page.getByLabel('start_range')).toHaveValue('3.51');
  await expect(page.getByLabel('end_range')).toHaveValue('2.54');
  await expect(duration).toHaveValue('7.5'); await expect(await openTimeSlider(page, 'Duration')).toHaveValue('7.5');
  await page.screenshot({ path: 'test-results/interstitial-sliders.png' });
  await addDraft(page, 12);
  await page.getByRole('button', { name: 'All interstitials' }).click();
  await page.getByRole('button', { name: 'Select Interstitial 1', exact: true }).click();
});

test('composition export with crossfades disabled preserves frame counts, generated-only bounds and audio through both cuts', async ({ page }) => {
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
  expect(result.videoDuration).toBeCloseTo(8, 3); expect(result.audioDuration).toBeCloseTo(8, 1);
  expect(result.stats.packetCount).toBe(192);
  expect(result.stats.averagePacketRate).toBeCloseTo(24, 5);
  expect(result.colors[0][0]).toBeGreaterThan(180); expect(result.colors[1][1]).toBeGreaterThan(180); expect(result.colors[2][1]).toBeGreaterThan(180); expect(result.colors[3][0]).toBeGreaterThan(180);
});
