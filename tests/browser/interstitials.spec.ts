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
  await page.route('https://fal.media/interstitial-fixture.mp4', route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), buffer.length - 1) : buffer.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4', headers: { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${buffer.length}` } : {}) }, body: buffer.subarray(start, end + 1) });
  });
  return buffer;
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('sparko:interstitials:v1:default:episode_mock.mp4') || '[]'));
async function addDraft(page: Page, time = 5) {
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill(String(time));
  await page.getByRole('button', { name: 'Add draft P' }).click();
  await expect(page.getByLabel('start_range')).toHaveValue('2');
  await expect(page.getByLabel('end_range')).toHaveValue('2');
  await page.getByLabel('Interstitial prompt').fill('A green interstitial scene');
}
test.beforeEach(async ({ page }) => {
  await page.route('**/api/status', async route => { const response = await route.fetch(); const status = await response.json(); await route.fulfill({ json: { ...status, providers: { ...status.providers, fal: true } } }); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add draft P' })).toBeEnabled();
});

test('draft editor, preparation, generation and a progressively buffered interstitial on one timeline', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await generatedFixture(page);
  let submitted = '', polls = 0;
  await page.route('**/api/interstitials', async route => { submitted = route.request().postDataBuffer()!.toString('latin1'); await route.fulfill({ status: 202, json: { requestId: 'fixture-job-1234', status: 'IN_QUEUE' } }); });
  await page.route('**/api/fal/jobs/fixture-job-1234', route => route.fulfill({ json: ++polls < 2 ? { requestId: 'fixture-job-1234', status: 'IN_PROGRESS' } : { requestId: 'fixture-job-1234', status: 'COMPLETED', videoUrl: 'https://fal.media/interstitial-fixture.mp4', insertion: { start: 2, duration: 5, totalDuration: 9 } } }));
  const originalDuration = await page.locator('video').evaluate(video => (video as HTMLVideoElement).duration);
  await page.getByLabel('Choose subtitle file').setInputFiles({ name: 'source.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00:04.000 --> 00:00:06.000\nSource dialogue across the cut\n') });
  const cues = () => page.locator('video').evaluate(video => Array.from((video as HTMLVideoElement).textTracks[0]?.cues || []).map(cue => [cue.startTime, cue.endTime]));
  await expect.poll(cues).toEqual([[4, 6]]);
  await addDraft(page);
  await page.getByLabel('start_range').fill('5'); await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  await page.getByLabel('start_range').fill('2'); await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Generating scene' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('5.00s interstitial · ready in the timeline')).toBeVisible({ timeout: 60_000 });
  expect(submitted).toContain('interstitial-reference.mp4'); expect(submitted).toContain('ftyp');
  expect(submitted).toContain('name="start"\r\n\r\n2'); expect(submitted).toContain(`name="resume"\r\n\r\n${49 / 24}`);
  expect(submitted).toContain('name="fps"\r\n\r\n24');
  const normalizedReference = await page.evaluate(async (body: string) => {
    const bytes = Uint8Array.from(body, char => char.charCodeAt(0));
    const response = new Response(bytes, { headers: { 'Content-Type': `multipart/form-data; boundary=${body.slice(2, body.indexOf('\r\n'))}` } });
    const file = (await response.formData()).get('video') as File;
    const { Input, BlobSource, ALL_FORMATS } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try { return (await (await input.getPrimaryVideoTrack()).computePacketStats()).averagePacketRate; }
    finally { input.dispose(); }
  }, submitted);
  expect(normalizedReference).toBeCloseTo(24, 5);
  await expect(page.locator('.rendered-interstitial')).toHaveCount(1);
  await expect.poll(() => page.getByRole('slider', { name: 'Video timeline', exact: true }).getAttribute('max')).toBe(String(Math.round(originalDuration * 24) / 24 + 5));
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).readyState), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator('video')).toHaveAttribute('src', /^blob:/);
  await expect.poll(cues).toEqual([[4, 5], [10, 11]]);
  const green = () => page.locator('video').evaluate(video => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d')!; ctx.drawImage(video as HTMLVideoElement, 0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; });
  await expect.poll(async () => (await green())[1], { timeout: 60_000 }).toBeGreaterThan(180);
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('10');
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).press('ArrowRight');
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime), { timeout: 60_000 }).toBeCloseTo(10.04, 2);
  await expect.poll(async () => { const [r, g, b] = await green(); return g > 180 && r < 20 && b < 20; }).toBe(false);
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('5');
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).press('ArrowLeft');
  await page.locator('.video-stage').hover(); await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime), { timeout: 60_000 }).toBeGreaterThan(5.2);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect((await green())[1]).toBeGreaterThan(180);
  await page.getByRole('button', { name: 'All interstitials' }).click();
  await expect(page.getByRole('button', { name: 'Select Interstitial 1', exact: true })).toBeVisible();
  expect((await saved(page))[0].phase).toBe('ready');
  await page.reload(); await expect(page.locator('.rendered-interstitial')).toHaveCount(1);
  await page.getByRole('button', { name: 'Select rendered Interstitial 1' }).click();
  await expect(page.getByLabel('Interstitial prompt')).toHaveValue('A green interstitial scene');
  await expect.poll(async () => (await green())[1], { timeout: 60_000 }).toBeGreaterThan(180);
  await page.screenshot({ path: 'test-results/interstitial-ready.png' });
  const marker = page.locator('.timeline-pin');
  const pin = (await marker.boundingBox())!;
  const track = (await page.locator('.timeline-track').boundingBox())!;
  const duration = Number(await page.getByRole('slider', { name: 'Video timeline', exact: true }).getAttribute('max'));
  const beforeMove = (await saved(page))[0];
  await page.mouse.move(pin.x + pin.width / 2, pin.y + pin.height / 2); await page.mouse.down();
  await page.mouse.move(track.x + track.width * 16 / duration, pin.y + pin.height / 2, { steps: 8 }); await page.mouse.up();
  expect((await saved(page))[0].time).toBeCloseTo(16, 1);
  expect((await saved(page))[0]).toMatchObject({ phase: 'ready', requestId: beforeMove.requestId, result: beforeMove.result });
  const movedTime = (await saved(page))[0].time;
  await marker.focus(); await page.keyboard.press('ArrowRight');
  expect((await saved(page))[0].time).toBeCloseTo(movedTime + 1 / 24, 6);
  await expect.poll(() => page.locator('.rendered-interstitial').evaluate(element => parseFloat((element as HTMLElement).style.left))).toBeCloseTo((movedTime + 1 / 24) / duration * 100, 3);
  await page.getByRole('button', { name: 'Remove Interstitial 1' }).click();
  await expect(page.locator('.rendered-interstitial')).toHaveCount(0);
  await expect(page.locator('video')).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).duration)).toBe(originalDuration);
  await expect(page.getByText('No interstitials yet')).toBeVisible();
  expect(errors).toEqual([]);
});

test('queued jobs recover after reload, cancel, and preserve draft fields', async ({ page }) => {
  let cancelled = false;
  await page.route('**/api/interstitials', route => route.fulfill({ status: 202, json: { requestId: 'recover-job-1234', status: 'IN_QUEUE' } }));
  await page.route('**/api/fal/jobs/recover-job-1234', route => {
    if (route.request().method() === 'DELETE') cancelled = true;
    return route.fulfill({ json: { requestId: 'recover-job-1234', status: cancelled ? 'CANCELLED' : 'IN_QUEUE', queuePosition: 2 } });
  });
  await addDraft(page, 8); await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByText('Queued · position 3')).toBeVisible({ timeout: 60_000 });
  await page.reload(); await page.getByRole('button', { name: 'Select Interstitial 1', exact: true }).click();
  await expect(page.getByText('Queued · position 3')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel interstitial generation' }).click();
  await expect(page.getByRole('button', { name: 'Return to draft' })).toBeVisible(); expect(cancelled).toBe(true);
  await page.getByRole('button', { name: 'Return to draft' }).click(); await expect(page.getByLabel('Interstitial prompt')).toHaveValue('A green interstitial scene');
  await page.getByRole('button', { name: 'All interstitials' }).click();
  await page.getByRole('button', { name: 'Remove Interstitial 1' }).click(); await expect(page.getByText('No interstitials yet')).toBeVisible();
});

test('composition export preserves frame counts, generated-only bounds and audio through both cuts', async ({ page }) => {
  await generatedFixture(page);
  const result = await page.evaluate(async () => {
    const { TimelineComposition } = await import('/src/media/TimelineComposition.ts' as string);
    const { TimelineStream } = await import('/src/media/TimelineStream.ts' as string);
    const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const url = 'https://fal.media/interstitial-fixture.mp4';
    const composition = new TimelineComposition({ id: 'source', name: 'Source', url }, { duration: 3, fps: 25, width: 160, height: 90, codec: 'avc', hasAudio: true },
      [{ id: 'insert', label: 'Insert', time: 1, phase: 'ready', result: { url, start: 2, duration: 5, totalDuration: 9 } }]);
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
