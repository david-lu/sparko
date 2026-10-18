import { expect, test } from './fixtures';

test('Comfy generation, status recovery, and regeneration', async ({ page }) => {
  await page.route('**/api/status', async route => { const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { openai: false, gemini: false, comfy: true } } }); });
  await page.route('**/api/comfy/status', route => route.fulfill({ json: { ready: true } }));
  let complete = false, failStatus = false, comfySubmissions = 0;
  const progressDetails = { stage: 'Generating video and audio', step: 9, steps: 20 };
  await page.route('**/api/comfy/jobs/comfy-test-job/events', route => route.fulfill({ contentType: 'text/event-stream',
    body: `event: progress\ndata: ${JSON.stringify({ type: 'progress', progress: .98, progressDetails })}\n\n` }));
  await page.route('**/api/comfy/interstitials', async route => {
    comfySubmissions++;
    const form = await new Response(Uint8Array.from(route.request().postDataBuffer()!), { headers: { 'Content-Type': route.request().headers()['content-type'] } }).formData();
    expect(form.get('before')).toBe('1.625'); expect(form.get('after')).toBe('1.625'); expect(form.get('duration')).toBe('6');
    expect(form.get('prompt')).toBe('Continue the motion'); expect((form.get('video') as File).size).toBeGreaterThan(1000);
    expect(form.get('maskInjection')).toBe(comfySubmissions === 1 ? 'vignette' : 'standard');
    expect(form.has('interpolateMiddle')).toBe(false);
    await route.fulfill({ status: 202, json: { requestId: 'comfy-test-job', status: 'IN_QUEUE', insertion: { start: 39 / 24, duration: 148 / 24, totalDuration: 226 / 24 } } });
  });
  await page.route('**/api/comfy/jobs/comfy-test-job', route => failStatus
    ? route.fulfill({ status: 500, json: { error: 'The request failed. Please try again.' } })
    : route.fulfill({ json: complete
      ? { requestId: 'comfy-test-job', status: 'COMPLETED', videoUrl: '/api/comfy/assets/comfy-test-asset/content' }
      : { requestId: 'comfy-test-job', status: 'IN_PROGRESS', progress: .98, progressDetails } }));
  await page.goto('/');
  await page.getByRole('button', { name: /Sample video/ }).click();
  await expect(page.getByRole('button', { name: /^Add regular interstitial/ })).toBeEnabled({ timeout: 60_000 });
  const bytes = await page.evaluate(async () => {
    const { Output, BufferTarget, Mp4OutputFormat, CanvasSource } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const canvas = new OffscreenCanvas(160, 96), ctx = canvas.getContext('2d')!;
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 100_000 });
    output.addVideoTrack(video, { frameRate: 24 }); await output.start();
    for (let frame = 0; frame < 226; frame++) { ctx.fillStyle = frame >= 39 && frame < 187 ? '#00ee00' : '#ee0000'; ctx.fillRect(0, 0, 160, 96); await video.add(frame / 24, 1 / 24); }
    video.close(); await output.finalize(); return [...new Uint8Array(output.target.buffer)];
  });
  let releaseDownload!: () => void;
  const downloading = new Promise<void>(resolve => { releaseDownload = resolve; });
  await page.route('**/api/comfy/assets/comfy-test-asset/content', async route => {
    expect(route.request().headers()['x-sparko-request']).toBe('1');
    await downloading;
    return route.fulfill({ contentType: 'video/mp4', body: Buffer.from(bytes) });
  });
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('5');
  await page.getByRole('button', { name: /^Add regular interstitial/ }).click();
  await expect(page.getByRole('combobox', { name: 'Video generation method' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Prompt expansion' })).toHaveCount(0);
  await expect(page.getByText(/6.167s generated/)).toBeVisible();
  await page.getByLabel('Interstitial prompt').fill('Continue the motion');
  const mask = page.getByRole('button', { name: /^Mask injection:/ });
  await expect(mask).toContainText('Standard generation');
  await mask.click();
  await page.getByRole('radio', { name: /FILM \+ vignette mask/ }).click();
  await expect(mask).toContainText('FILM + vignette');
  await page.setViewportSize({ width: 390, height: 844 });
  const optionPosition = () => mask.evaluate(element => element.getBoundingClientRect().top - element.closest('form')!.getBoundingClientRect().top);
  const optionTop = await optionPosition();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Generating interstitial' })).toHaveAttribute('value', '0.455', { timeout: 60_000 });
  expect(await optionPosition()).toBeCloseTo(optionTop, 0);
  await expect(page.locator('.timeline-generation-spinner')).toHaveCount(1);
  await expect(page.locator('.task-status')).toContainText('Generating video and audio · step 9/20 · 46% estimated overall');
  await expect(page.locator('.task-status')).not.toContainText('98%');
  await expect(page.locator('.timeline-generation-spinner')).toHaveAttribute('aria-label', /step 9\/20.*46% estimated overall/);
  failStatus = true;
  await expect(page.getByRole('alert')).toHaveText('The request failed. Please try again.');
  await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled();
  failStatus = false;
  await page.getByRole('button', { name: 'Check result', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Generating interstitial' })).toHaveAttribute('value', '0.455');
  expect(comfySubmissions).toBe(1);
  await expect(page.getByRole('progressbar', { name: 'Generating interstitial' })).toHaveAttribute('value', '0.455');
  complete = true;
  await expect(page.locator('.task-status')).toContainText('Downloading generated video');
  await expect(page.getByRole('progressbar', { name: 'Downloading generated video' })).toHaveJSProperty('position', -1);
  releaseDownload();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('sparko:interstitials:v1:default:sample.mp4')!)[0]);
  await expect.poll(async () => (await saved()).phase, { timeout: 60_000 }).toBe('ready');
  expect((await saved()).result.duration).toBe(148 / 24);
  expect((await saved()).requestMethod).toBe('comfy');
  expect((await saved()).generationSettings.maskInjection).toBe('vignette');
  expect(await optionPosition()).toBeCloseTo(optionTop, 0);
  await expect(page.getByLabel('Generated video for Untitled')).toBeVisible();
  await expect(page.locator('.rendered-interstitial')).toHaveCount(1);
  const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download full video' }).click(); await download;
  await page.screenshot({ path: 'test-results/comfy-interstitial.png' });
  await mask.click();
  await page.getByRole('radio', { name: /Standard generation/ }).click();
  await expect(page.locator('.interstitial-edited')).toHaveText('Edited');
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect.poll(async () => comfySubmissions).toBe(2);
  await expect.poll(async () => (await saved()).phase, { timeout: 60_000 }).toBe('ready');
  expect((await saved()).result.duration).toBe(148 / 24);
  expect((await saved()).requestMethod).toBe('comfy');
  expect((await saved()).generationSettings.maskInjection).toBe('standard');
});
