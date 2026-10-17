import { expect, test } from './fixtures';

test('Comfy generation, provider changes during a job, reload recovery, and Fal regeneration', async ({ page }) => {
  await page.route('**/api/status', async route => { const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { openai: false, gemini: false, fal: true, comfy: true } } }); });
  await page.route('**/api/comfy/status', route => route.fulfill({ json: { ready: true } }));
  let complete = false, comfySubmissions = 0, falSubmissions = 0;
  const progressDetails = { stage: 'Generating video and audio', step: 8, steps: 20 };
  await page.route('**/api/comfy/jobs/comfy-test-job/events', route => route.fulfill({ contentType: 'text/event-stream',
    body: `event: progress\ndata: ${JSON.stringify({ type: 'progress', progress: .4, progressDetails })}\n\n` }));
  await page.route('**/api/comfy/interstitials', async route => {
    comfySubmissions++;
    const form = await new Response(Uint8Array.from(route.request().postDataBuffer()!), { headers: { 'Content-Type': route.request().headers()['content-type'] } }).formData();
    expect(form.get('before')).toBe('1.625'); expect(form.get('after')).toBe('1.625'); expect(form.get('duration')).toBe('6');
    expect(form.get('prompt')).toBe('Continue the motion'); expect((form.get('video') as File).size).toBeGreaterThan(1000);
    await route.fulfill({ status: 202, json: { requestId: 'comfy-test-job', status: 'IN_QUEUE', insertion: { start: 39 / 24, duration: 148 / 24, totalDuration: 226 / 24 } } });
  });
  await page.route('**/api/comfy/jobs/comfy-test-job', route => route.fulfill({ json: complete
    ? { requestId: 'comfy-test-job', status: 'COMPLETED', videoUrl: '/api/comfy/assets/comfy-test-asset/content' }
    : { requestId: 'comfy-test-job', status: 'IN_PROGRESS', progress: .4, progressDetails } }));
  await page.route('**/api/interstitials', route => { falSubmissions++; return route.fulfill({ status: 202, json: { requestId: 'fal-next-job', status: 'IN_QUEUE' } }); });
  await page.route('**/api/fal/jobs/fal-next-job', route => route.fulfill({ json: { requestId: 'fal-next-job', status: 'COMPLETED', videoUrl: 'https://fal.media/comfy-test-fal.mp4', insertion: { start: 2, duration: 6, totalDuration: 226 / 24 } } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Add interstitial/ })).toBeEnabled({ timeout: 60_000 });
  const bytes = await page.evaluate(async () => {
    const { Output, BufferTarget, Mp4OutputFormat, CanvasSource } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const canvas = new OffscreenCanvas(160, 96), ctx = canvas.getContext('2d')!;
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 100_000 });
    output.addVideoTrack(video, { frameRate: 24 }); await output.start();
    for (let frame = 0; frame < 226; frame++) { ctx.fillStyle = frame >= 39 && frame < 187 ? '#00ee00' : '#ee0000'; ctx.fillRect(0, 0, 160, 96); await video.add(frame / 24, 1 / 24); }
    video.close(); await output.finalize(); return [...new Uint8Array(output.target.buffer)];
  });
  await page.route('**/api/comfy/assets/comfy-test-asset/content', route => {
    expect(route.request().headers()['x-sparko-request']).toBe('1');
    return route.fulfill({ contentType: 'video/mp4', body: Buffer.from(bytes) });
  });
  await page.route('https://fal.media/comfy-test-fal.mp4', route => route.fulfill({ contentType: 'video/mp4', body: Buffer.from(bytes) }));
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('5');
  await page.getByRole('button', { name: /^Add interstitial/ }).click();
  const method = page.getByRole('combobox', { name: 'Video generation method' });
  await expect(method).toHaveValue('fal'); await method.selectOption('comfy');
  await expect(page.getByRole('checkbox', { name: 'Prompt expansion' })).toHaveCount(0);
  await expect(page.getByText(/6.167s generated/)).toBeVisible();
  await page.getByLabel('Interstitial prompt').fill('Continue the motion');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Generating interstitial' })).toHaveAttribute('value', '0.4', { timeout: 60_000 });
  await expect(page.locator('.timeline-generation-spinner')).toHaveCount(1);
  await expect(page.locator('.task-status')).toContainText('Generating video and audio · step 8/20 · 40%');
  await expect(page.locator('.timeline-generation-spinner')).toHaveAttribute('aria-label', /step 8\/20/);
  await method.selectOption('fal');
  await page.reload();
  await page.getByRole('button', { name: 'Select Untitled', exact: true }).click();
  await expect(method).toHaveValue('fal');
  await expect(page.getByRole('progressbar', { name: 'Generating interstitial' })).toBeVisible();
  complete = true;
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('sparko:interstitials:v1:default:episode_mock.mp4')!)[0]);
  await expect.poll(async () => (await saved()).phase, { timeout: 60_000 }).toBe('ready');
  expect((await saved()).result.duration).toBe(148 / 24);
  expect((await saved()).requestMethod).toBe('comfy');
  await expect(page.getByLabel('Generated video for Untitled')).toBeVisible();
  await expect(page.locator('.rendered-interstitial')).toHaveCount(1);
  const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download full video' }).click(); await download;
  await page.screenshot({ path: 'test-results/comfy-interstitial.png' });
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect.poll(async () => (await saved()).requestMethod).toBe('fal');
  await expect.poll(async () => (await saved()).phase, { timeout: 60_000 }).toBe('ready');
  expect((await saved()).result.duration).toBe(6);
  expect(comfySubmissions).toBe(1); expect(falSubmissions).toBe(1);
});
