import { expect, test, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';

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

test('time sliders and number inputs stay synchronized and survive reopening a draft', async ({ page }) => {
  await addDraft(page);
  const expansion = page.getByRole('checkbox', { name: 'Prompt expansion', exact: true });
  await expect(expansion).not.toBeChecked();
  await expansion.focus(); await expansion.press('Space'); await expect(expansion).toBeChecked();
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
  await expect(page.getByRole('spinbutton', { name: 'Duration', exact: true })).toHaveValue('6');
  for (const [sliderName, inputName, fromSlider, fromNumber] of [
    ['Start range slider', 'start_range', '1.625', '3.51'],
    ['End range slider', 'end_range', '0.1', '2.54'],
    ['Duration slider', 'Duration', '13', '7.33'],
  ]) {
    const slider = page.getByRole('slider', { name: sliderName, exact: true });
    const number = page.getByRole('spinbutton', { name: inputName, exact: true });
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
  await expect(page.getByText(/Adds a 7.5s scene/)).toBeVisible();
  await expect.poll(async () => (await saved(page))[0]).toMatchObject({ start_range: 3.51, end_range: 2.54, duration: 7.5, enable_prompt_expansion: true });
  await page.reload();
  await page.getByRole('button', { name: 'Select Interstitial 1', exact: true }).click();
  await expect(page.getByLabel('start_range')).toHaveValue('3.51');
  await expect(page.getByLabel('end_range')).toHaveValue('2.54');
  await expect(duration).toHaveValue('7.5'); await expect(slider).toHaveValue('7.5');
  await expect(expansion).toBeChecked();
  await page.screenshot({ path: 'test-results/interstitial-sliders.png' });
  await addDraft(page, 12); await expect(expansion).not.toBeChecked();
  await page.getByRole('button', { name: 'All interstitials' }).click();
  await page.getByRole('button', { name: 'Select Interstitial 1', exact: true }).click();
  await expect(expansion).toBeChecked();
});

test('draft editor, preparation, generation and a progressively buffered interstitial on one timeline', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const fullVideo = await generatedFixture(page);
  const downloadFullVideo = async () => {
    const downloading = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download full video', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('Interstitial 1-full.mp4');
    // Exact bytes preserve the reference footage and audio as well as the inserted scene.
    expect(await readFile((await download.path())!)).toEqual(fullVideo);
  };
  let submitted = '', polls = 0;
  await page.route('**/api/interstitials', async route => { submitted = route.request().postDataBuffer()!.toString('latin1'); await route.fulfill({ status: 202, json: { requestId: 'fixture-job-1234', status: 'IN_QUEUE' } }); });
  await page.route('**/api/fal/jobs/fixture-job-1234', route => route.fulfill({ json: ++polls < 2 ? { requestId: 'fixture-job-1234', status: 'IN_PROGRESS' } : { requestId: 'fixture-job-1234', status: 'COMPLETED', videoUrl: 'https://fal.media/interstitial-fixture.mp4', insertion: { start: 2, duration: 5, totalDuration: 9 } } }));
  const originalDuration = await page.locator('video').evaluate(video => (video as HTMLVideoElement).duration);
  await page.getByLabel('Choose subtitle file').setInputFiles({ name: 'source.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00:04.000 --> 00:00:06.000\nSource dialogue across the cut\n') });
  const cues = () => page.locator('video').evaluate(video => Array.from((video as HTMLVideoElement).textTracks[0]?.cues || []).map(cue => [cue.startTime, cue.endTime]));
  await expect.poll(cues).toEqual([[4, 6]]);
  await addDraft(page);
  await expect(page.getByRole('link', { name: 'Download full video', exact: true })).toHaveCount(0);
  await page.getByRole('slider', { name: 'Duration slider', exact: true }).fill('5');
  await page.getByLabel('start_range').fill('5'); await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  await page.getByLabel('start_range').fill('2'); await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Generating scene' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.timeline-pin .timeline-generation-spinner')).toBeVisible();
  await expect(page.locator('.timeline-pin')).toHaveAttribute('title', /Generating scene/);
  await expect(page.getByText('5.00s interstitial · ready in the timeline')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Includes the start and end reference footage · 9.00s total.')).toBeVisible();
  await downloadFullVideo();
  expect(submitted).toContain('interstitial-reference.mp4'); expect(submitted).toContain('ftyp');
  expect(submitted).toContain('name="start"\r\n\r\n2'); expect(submitted).toContain(`name="resume"\r\n\r\n${49 / 24}`);
  expect(submitted).toContain('name="fps"\r\n\r\n24');
  expect(submitted).toContain('name="duration"\r\n\r\n5');
  expect(submitted).toContain('name="enable_prompt_expansion"\r\n\r\nfalse');
  await expect(page.getByRole('checkbox', { name: 'Prompt expansion', exact: true })).toBeEnabled();
  await expect(page.getByRole('slider', { name: 'Duration slider', exact: true })).toBeEnabled();
  await expect(page.getByRole('spinbutton', { name: 'Duration', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled();
  await expect(page.locator('.timeline-generation-spinner')).toHaveCount(0);
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
  const thumbnail = page.locator('.interstitial-thumbnail');
  await expect(thumbnail).toBeVisible();
  // The fixture's reference footage is red; the actual inserted scene starts green at 2s.
  const firstFrame = await thumbnail.evaluate(async element => {
    const image = new Image();
    image.src = getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/)![1];
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  });
  expect(firstFrame[1]).toBeGreaterThan(180); expect(firstFrame[0]).toBeLessThan(20);
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
  let remoteReads = 0;
  await page.route('https://fal.media/**', route => { remoteReads++; return route.abort(); });
  await page.reload(); await expect(page.locator('.rendered-interstitial')).toHaveCount(1);
  await expect(thumbnail).toBeVisible();
  await page.getByRole('button', { name: 'Select rendered Interstitial 1' }).click();
  await expect(page.getByLabel('Interstitial prompt')).toHaveValue('A green interstitial scene');
  await expect(page.getByRole('spinbutton', { name: 'Duration', exact: true })).toHaveValue('5');
  await downloadFullVideo(); expect(remoteReads).toBe(0);
  await expect.poll(async () => (await green())[1], { timeout: 60_000 }).toBeGreaterThan(180);
  const timelineInput = page.getByRole('slider', { name: 'Video timeline', exact: true });
  const rendered = page.getByRole('button', { name: 'Select rendered Interstitial 1' });
  const clickScene = async (fraction: number) => {
    const clip = (await rendered.boundingBox())!;
    const track = (await page.locator('.timeline-track').boundingBox())!;
    const duration = Number(await timelineInput.getAttribute('max'));
    const x = clip.x + clip.width * fraction;
    // Allow one input pixel and one 24 fps frame of snapping error.
    const tolerance = duration / track.width + 1 / 24;
    await page.mouse.click(x, clip.y + clip.height * 0.75);
    await expect.poll(async () => Math.abs(Number(await timelineInput.inputValue()) - (5 + 5 * fraction))).toBeLessThanOrEqual(tolerance);
    await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime), { timeout: 60_000 })
      .toBeCloseTo(Number(await timelineInput.inputValue()), 5);
    await expect(page.locator('video')).toHaveJSProperty('paused', true);
    const head = (await page.locator('.playhead').boundingBox())!;
    expect(Math.abs(head.x - x)).toBeLessThanOrEqual(track.width / duration / 24 + 1);
    // The playhead is drawn above the clip while allowing pointer clicks through it.
    expect(await page.locator('.playhead').evaluate(element => {
      const head = element as HTMLElement;
      const rect = head.getBoundingClientRect();
      const pointerEvents = head.style.pointerEvents;
      try {
        head.style.pointerEvents = 'auto';
        return head.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height * 0.75));
      } finally { head.style.pointerEvents = pointerEvents; }
    })).toBe(true);
    await expect.poll(async () => (await green())[1], { timeout: 60_000 }).toBeGreaterThan(180);
  };
  await clickScene(0.25); await clickScene(0.75);
  await page.getByRole('slider', { name: 'Timeline zoom', exact: true }).fill('8');
  await page.locator('.timeline-scroll').evaluate(element => { element.scrollLeft = 250; });
  expect(await page.locator('.timeline-scroll').evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await clickScene(0.4);
  await page.screenshot({ path: 'test-results/interstitial-playhead.png' });
  await rendered.focus(); await rendered.press('Enter');
  await expect(timelineInput).toHaveValue('5');
  await page.getByRole('button', { name: 'Fit timeline', exact: true }).click();
  await page.getByRole('button', { name: 'All interstitials' }).click();
  await page.getByRole('button', { name: 'Select Interstitial 1', exact: true }).click();
  await expect(timelineInput).toHaveValue('5');
  await page.screenshot({ path: 'test-results/interstitial-ready.png' });
  const marker = page.locator('.timeline-pin');
  const pin = (await marker.boundingBox())!;
  const track = (await page.locator('.timeline-track').boundingBox())!;
  const scene = (await rendered.boundingBox())!;
  const duration = Number(await page.getByRole('slider', { name: 'Video timeline', exact: true }).getAttribute('max'));
  const beforeMove = (await saved(page))[0];
  await page.mouse.move(pin.x + pin.width / 2, pin.y + pin.height / 2); await page.mouse.down();
  // The handle now sits at the scene's center; move its insertion anchor to 16 seconds.
  await page.mouse.move(track.x + track.width * 16 / duration + scene.width / 2, pin.y + pin.height / 2, { steps: 8 }); await page.mouse.up();
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

test('a failed interstitial remains editable and retries directly with its changed settings', async ({ page }) => {
  await generatedFixture(page);
  const submissions: string[] = []; let cancellations = 0;
  const rejection = 'fal.ai rejected the request: The reference could not be processed.';
  await page.route('**/api/interstitials', route => {
    submissions.push(route.request().postDataBuffer()!.toString('latin1'));
    return route.fulfill({ status: 202, json: { requestId: `retry-job-${submissions.length}`, status: 'IN_QUEUE' } });
  });
  await page.route('**/api/fal/jobs/retry-job-*', route => {
    const requestId = route.request().url().split('/').at(-1);
    if (route.request().method() === 'DELETE') { cancellations++; return route.fulfill({ json: { requestId, status: 'CANCELLED' } }); }
    if (requestId === 'retry-job-1') return route.fulfill({ status: 422, json: { error: rejection } });
    return route.fulfill({ json: { requestId, status: 'COMPLETED', videoUrl: 'https://fal.media/interstitial-fixture.mp4', insertion: { start: 2, duration: 5, totalDuration: 9 } } });
  });
  await addDraft(page);
  const expansion = page.getByRole('checkbox', { name: 'Prompt expansion', exact: true });
  await expansion.check();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(rejection, { timeout: 60_000 });
  expect(submissions[0]).toContain('name="enable_prompt_expansion"\r\n\r\ntrue');
  await expect(page.getByLabel('Interstitial prompt')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Return to draft' })).toHaveCount(0);
  const original = (await saved(page))[0];
  await page.reload();
  await page.getByRole('button', { name: 'Select Interstitial 1', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(rejection);
  await expect(expansion).toBeChecked(); await expansion.uncheck();
  await page.getByLabel('Interstitial prompt').fill('A corrected interstitial scene');
  await page.getByLabel('start_range').fill('3');
  await page.getByLabel('end_range').fill('1.5');
  await page.getByRole('slider', { name: 'Duration slider', exact: true }).fill('7.5');
  await expect(page.getByRole('alert')).toHaveText(rejection);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('5.00s interstitial · ready in the timeline')).toBeVisible({ timeout: 60_000 });
  expect(submissions).toHaveLength(2); expect(cancellations).toBe(1);
  expect(submissions[1]).toContain('name="start"\r\n\r\n3');
  expect(submissions[1]).toContain('name="duration"\r\n\r\n7.5');
  expect(submissions[1]).toContain('name="enable_prompt_expansion"\r\n\r\nfalse');
  expect(submissions[1]).toContain('A corrected interstitial scene');
  expect(await saved(page)).toEqual([expect.objectContaining({ id: original.id, time: original.time, phase: 'ready', start_range: 3, end_range: 1.5, duration: 7.5, enable_prompt_expansion: false })]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('completed scenes retry without removing the current video, survive failure and reload, then replace it', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await generatedFixture(page);
  let holdDownload = false;
  let finishDownload!: () => void;
  const downloadGate = new Promise<void>(resolve => { finishDownload = resolve; });
  await page.route('https://fal.media/interstitial-fixture.mp4', async route => {
    if (holdDownload) await downloadGate;
    await route.fallback();
  });
  const submissions: string[] = [];
  let mode: 'waiting' | 'failed' | 'ready' = 'waiting';
  await page.route('**/api/interstitials', route => {
    submissions.push(route.request().postDataBuffer()!.toString('latin1'));
    return route.fulfill({ status: 202, json: { requestId: `regenerate-job-${submissions.length}`, status: 'IN_QUEUE' } });
  });
  await page.route('**/api/fal/jobs/regenerate-job-*', route => {
    const requestId = route.request().url().split('/').at(-1);
    if (route.request().method() === 'DELETE') return route.fulfill({ json: { requestId, status: 'CANCELLED' } });
    if (requestId !== 'regenerate-job-1') {
      if (mode === 'waiting') return route.fulfill({ json: { requestId, status: 'IN_PROGRESS' } });
      if (mode === 'failed') return route.fulfill({ status: 422, json: { error: 'Replacement generation failed.' } });
    }
    return route.fulfill({ json: { requestId, status: 'COMPLETED', videoUrl: 'https://fal.media/interstitial-fixture.mp4',
      insertion: { start: 2, duration: requestId === 'regenerate-job-1' ? 5 : 6, totalDuration: 9 } } });
  });
  const timeline = page.getByRole('slider', { name: 'Video timeline', exact: true });
  const sourceDuration = Number(await timeline.getAttribute('max'));
  await addDraft(page); await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByText('5.00s interstitial · ready in the timeline')).toBeVisible({ timeout: 60_000 });
  const original = (await saved(page))[0];
  const thumbnail = page.locator('.interstitial-thumbnail');
  await expect(thumbnail).toBeVisible();
  const oldThumbnail = await thumbnail.evaluate(element => getComputedStyle(element).backgroundImage);
  const oldUrl = await page.getByRole('link', { name: 'Download full video' }).getAttribute('href');
  await page.getByLabel('Interstitial prompt').fill('A replacement scene');
  await page.getByRole('spinbutton', { name: 'Duration', exact: true }).fill('6');
  await page.getByRole('checkbox', { name: 'Prompt expansion', exact: true }).check();
  const videoUrl = await page.locator('video').getAttribute('src');
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Generating scene' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel('Interstitial prompt')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Generating…', exact: true })).toBeDisabled();
  await expect(page.locator('.rendered-interstitial .timeline-generation-spinner')).toBeVisible();
  await expect(page.locator('.rendered-interstitial')).toHaveAttribute('title', /Generating scene/);
  await expect(page.locator('.timeline-pin .timeline-generation-spinner')).toHaveCount(0);
  await expect(thumbnail).toHaveCSS('background-image', oldThumbnail);
  await page.getByLabel('Interstitial prompt').fill('Edited while generating');
  await page.getByRole('slider', { name: 'Duration slider', exact: true }).fill('7');
  await page.getByRole('checkbox', { name: 'Prompt expansion', exact: true }).uncheck();
  await expect(page.getByText('Changes saved for the next generation.')).toBeVisible();
  await expect(page.locator('.rendered-interstitial')).toHaveCount(1);
  await expect(timeline).toHaveAttribute('max', String(sourceDuration + 5));
  await expect(page.locator('video')).toHaveAttribute('src', videoUrl!);
  await expect(page.getByRole('link', { name: 'Download full video' })).toHaveAttribute('href', oldUrl!);
  expect((await saved(page))[0].previousResult).toEqual(original.result);
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toContain('A replacement scene');
  expect(submissions[1]).toContain('name="enable_prompt_expansion"\r\n\r\ntrue');
  expect(submissions[1]).toContain('name="duration"\r\n\r\n6');
  await page.screenshot({ path: 'test-results/interstitial-regenerating.png' });
  // Recover an active retry from IndexedDB while keeping its earlier video available.
  await page.reload(); await expect(page.locator('.rendered-interstitial')).toHaveCount(1);
  await page.getByRole('button', { name: 'Select rendered Interstitial 1' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Generating scene' })).toBeVisible();
  await expect(page.getByLabel('Interstitial prompt')).toHaveValue('Edited while generating');
  await expect(page.getByRole('spinbutton', { name: 'Duration', exact: true })).toHaveValue('7');
  await expect(page.getByRole('checkbox', { name: 'Prompt expansion', exact: true })).not.toBeChecked();
  await expect(page.locator('.rendered-interstitial .timeline-generation-spinner')).toBeVisible();
  await expect(timeline).toHaveAttribute('max', String(sourceDuration + 5));
  mode = 'failed';
  await expect(page.getByRole('alert')).toHaveText('Replacement generation failed.');
  await expect(page.locator('.timeline-generation-spinner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Interstitial prompt')).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Download full video' })).toBeVisible();
  await expect(page.locator('.rendered-interstitial')).toHaveCount(1);
  // Cancelling another retry also leaves the same scene in place.
  mode = 'waiting';
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Generating scene' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Cancel interstitial generation' }).click();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  expect((await saved(page))[0]).toMatchObject({ phase: 'cancelled', previousResult: original.result });
  await expect(page.locator('.timeline-generation-spinner')).toHaveCount(0);
  await expect(timeline).toHaveAttribute('max', String(sourceDuration + 5));
  mode = 'ready'; holdDownload = true;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Loading generated video' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.rendered-interstitial .timeline-generation-spinner')).toBeVisible();
  await expect(page.locator('.rendered-interstitial')).toHaveAttribute('title', /Loading generated video/);
  await page.getByLabel('Interstitial prompt').fill('Edited while loading');
  finishDownload();
  await expect(page.getByText('6.00s interstitial · ready in the timeline')).toBeVisible({ timeout: 60_000 });
  await expect(timeline).toHaveAttribute('max', String(sourceDuration + 6));
  await expect(page.locator('.rendered-interstitial')).toHaveCount(1);
  const final = (await saved(page))[0];
  expect(final).toMatchObject({ id: original.id, time: original.time, phase: 'ready', prompt: 'Edited while loading', requestId: 'regenerate-job-4', generationSettings: { prompt: 'Edited while generating' } });
  expect(submissions[3]).toContain('Edited while generating');
  expect(submissions[3]).toContain('name="duration"\r\n\r\n7');
  expect(submissions[3]).toContain('name="enable_prompt_expansion"\r\n\r\nfalse');
  expect(final.previousResult).toBeUndefined();
  expect(final.result.assetId).not.toBe(original.result.assetId);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.timeline-generation-spinner')).toHaveCount(0);
  await page.getByLabel('Interstitial prompt').fill('Another completed-scene edit');
  await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled();
  await page.reload(); await expect(page.locator('.rendered-interstitial')).toHaveCount(1);
  await page.getByRole('button', { name: 'Select rendered Interstitial 1' }).click();
  await expect(page.getByLabel('Interstitial prompt')).toHaveValue('Another completed-scene edit');
  await expect(page.getByText('Changes saved for the next generation.')).toBeVisible();
  expect(submissions).toHaveLength(4); expect(errors).toEqual([]);
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
  await expect(page.locator('.timeline-pin .timeline-generation-spinner')).toBeVisible();
  await expect(page.locator('.timeline-pin')).toHaveAttribute('title', /Queued · position 3/);
  await page.getByLabel('Interstitial prompt').fill('Edited while queued');
  await page.reload(); await page.getByRole('button', { name: 'Select Interstitial 1', exact: true }).click();
  await expect(page.getByText('Queued · position 3')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel interstitial generation' }).click();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled(); expect(cancelled).toBe(true);
  await expect(page.getByRole('button', { name: 'Return to draft' })).toHaveCount(0);
  await expect(page.getByLabel('Interstitial prompt')).toHaveValue('Edited while queued');
  await expect(page.locator('.timeline-generation-spinner')).toHaveCount(0);
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
