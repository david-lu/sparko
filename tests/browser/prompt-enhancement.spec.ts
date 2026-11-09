import { setVideoReference, expect, test, openVideo, addBridge, saveAndReopen, readProject } from './fixtures';
import { readFile } from 'node:fs/promises';
import { readClipMetadata } from '../../src/media/clipMetadata';

const original = 'She asks, "What is 2 + 2?", and waits.';
const enhanced = 'In the same continuous shot, she gently asks, "What is 2 + 2?", and pauses. Preserve her position, pose, scale, background and framing. No position snaps or camera changes. All dialogue is in English.';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/status', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), providers: { openai: true, gemini: false, comfy: true } } });
  });
  await openVideo(page);
  await addBridge(page);
  await setVideoReference(page, 'end', true);
  await page.getByLabel('Video prompt').fill(original);
});

test('enhances with visual references, stays editable, and supports undo, redo and persistence', async ({ page }) => {
  let finish!: () => void, generations = 0;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/comfy/interstitials', route => { generations++; return route.fulfill({ status: 500, json: { error: 'Unexpected generation' } }); });
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ prompt: original, duration: 6, kind: 'interstitial' });
    expect(body.referenceFrames).toHaveLength(2);
    for (const frame of body.referenceFrames) expect(frame).toMatch(/^data:image\/jpeg;base64,/);
    await waiting;
    await route.fulfill({ json: { prompt: enhanced, model: 'test-model' } });
  });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enhancing…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel prompt enhancement' })).toBeVisible();
  finish();
  const prompt = page.getByLabel('Video prompt');
  await expect(prompt).toHaveValue(enhanced);
  await expect(prompt).toBeEditable();
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(prompt).toHaveValue(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(prompt).toHaveValue(enhanced);
  expect(generations).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/enhance-prompt-mobile.png' });
  await saveAndReopen(page);
  await page.locator('.story-clip.type-simple .story-clip-title').click();
  await expect(prompt).toHaveValue(enhanced);
});

test('preserves the draft on errors and ignores a late result after the user edits it', async ({ page }) => {
  let requests = 0, finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    requests++;
    if (requests === 1) return route.fulfill({ status: 502, json: { error: 'Prompt enhancement could not reach OpenAI. Try again.' } });
    await waiting;
    await route.fulfill({ json: { prompt: enhanced, model: 'test-model' } }).catch(() => undefined);
  });
  const prompt = page.getByLabel('Video prompt');
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  const toast = page.getByRole('alert').filter({ hasText: 'Video prompt enhancement failed' });
  await expect(toast).toContainText('Prompt enhancement could not reach OpenAI. Try again.');
  await expect(toast).toBeInViewport();
  await expect(page.locator('.task-status')).not.toContainText('could not reach');
  await expect(prompt).toHaveValue(original);
  await toast.getByRole('button', { name: 'Dismiss notification', exact: true }).press('Enter');
  await expect(toast).toHaveCount(0);
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await prompt.fill('My newer draft');
  await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeEnabled();
  finish();
  await expect(prompt).toHaveValue('My newer draft');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.task-status')).not.toContainText('could not reach');
});

test('carries enhanced dialogue timing through regeneration into the downloaded video', async ({ page }) => {
  for (const side of ['start', 'end'] as const) await setVideoReference(page, side, false);
  const draft = 'integrated_multimodal_description: [Shot 1] She holds a rock and asks <d>[English] A rock?</d>, then holds a bowl and asks <d>[English] Old vegetables?</d>\noverall_soundscape: Quiet room.\nnon_diegetic_music: N/A';
  const timed = 'integrated_multimodal_description: [Shot 1] Static camera. From 0 to 3 seconds: She holds the rock while asking <d>[English] A rock?</d> From 3 to 6 seconds: She puts down the rock and holds the bowl while asking <d>[English] Old vegetables?</d>\noverall_soundscape: Quiet room.\nnon_diegetic_music: N/A';
  const prompt = page.getByLabel('Video prompt');
  await prompt.fill(draft);
  await page.route('**/api/comfy/status*', route => route.fulfill({ json: { ready: true } }));
  const submitted: string[] = [];
  await page.route('**/api/comfy/interstitials', async route => {
    const form = await new Response(Uint8Array.from(route.request().postDataBuffer()!), { headers: { 'Content-Type': route.request().headers()['content-type'] } }).formData();
    submitted.push(String(form.get('prompt')).replace(/\r\n/g, '\n'));
    await route.fulfill({ status: 202, json: { requestId: `timing-job-${submitted.length}`, status: 'IN_QUEUE', insertion: { start: 0, duration: 6, totalDuration: 6 } } });
  });
  await page.route('**/api/comfy/jobs/timing-job-*', route => route.fulfill({ json: { requestId: route.request().url().split('/').at(-1), status: 'COMPLETED', videoUrl: '/api/comfy/assets/timing-result/content' } }));
  await page.route('**/api/comfy/jobs/timing-job-*/events', route => route.fulfill({ contentType: 'text/event-stream', body: '' }));
  const bytes = await page.evaluate(async () => {
    const { Output, BufferTarget, Mp4OutputFormat, CanvasSource } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const canvas = new OffscreenCanvas(160, 96), ctx = canvas.getContext('2d')!;
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    const video = new CanvasSource(canvas, { codec: 'avc', fullCodecString: 'avc1.42001e', bitrate: 100_000 });
    output.addVideoTrack(video, { frameRate: 24 }); await output.start();
    ctx.fillStyle = '#00ee00'; ctx.fillRect(0, 0, 160, 96);
    for (let frame = 0; frame < 144; frame++) await video.add(frame / 24, 1 / 24);
    video.close(); await output.finalize(); return [...new Uint8Array(output.target.buffer)];
  });
  await page.route('**/api/comfy/assets/timing-result/content', route => route.fulfill({ contentType: 'video/mp4', body: Buffer.from(bytes) }));
  const saved = async () => (await readProject(page)).interstitials[0];
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect.poll(async () => (await saved()).phase, { timeout: 60_000 }).toBe('ready');
  const previous = (await saved()).result;
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    expect(route.request().postDataJSON().prompt).toBe(draft);
    await route.fulfill({ json: { prompt: timed, model: 'test' } });
  });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect(prompt).toHaveValue(timed);
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect.poll(async () => (await saved()).result?.metadata?.id).not.toBe(previous.metadata.id);
  await expect.poll(async () => (await saved()).phase, { timeout: 60_000 }).toBe('ready');
  expect(submitted).toEqual([draft, timed]);
  const current = (await saved()).result;
  expect(current.assetId).not.toBe(previous.assetId);
  await page.locator('.inspector-output > summary').click();
  const pending = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download full video' }).click();
  const download = await pending;
  const metadata = await readClipMetadata(new Blob([await readFile((await download.path())!)]), new AbortController().signal);
  expect(metadata).toMatchObject({ id: current.metadata.id, prompt: timed, settings: { prompt: timed } });
});

for (const width of [1440, 390]) test(`preserves oversized drafts and enforces H3's limit without shifting controls at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const prompt = page.getByLabel('Video prompt'), draft = 'A'.repeat(7001);
  const tail = '<d>[English] A rock?</d>', shortened = 'A'.repeat(7000 - tail.length) + tail;
  await prompt.fill(draft);
  await expect(prompt).toHaveValue(draft);
  await expect(page.locator('.prompt-character-count')).toHaveText('7,001 / 7,000 characters');
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  await expect(page.locator('.task-status')).toContainText('7,000 characters or fewer');
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    expect(route.request().postDataJSON().prompt).toBe(draft);
    await pending; await route.fulfill({ json: { prompt: shortened, model: 'test' } });
  });
  const controls = () => page.locator('.interstitial-editor').evaluate(root => {
    const top = root.getBoundingClientRect().top;
    return ['textarea', '.prompt-character-count', '.generation-timeline-summary', 'button[type=submit]', '.task-status'].map(selector => {
      const box = root.querySelector(selector)!.getBoundingClientRect(); return { top: box.top - top, height: box.height };
    });
  });
  const before = await controls();
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enhancing…', exact: true })).toBeDisabled();
  expect(await controls()).toEqual(before);
  finish(); await expect(prompt).toHaveValue(shortened);
  await expect(page.locator('.prompt-character-count')).toHaveText('7,000 / 7,000 characters');
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
  expect(await controls()).toEqual(before);
  await page.locator('.prompt-character-count').scrollIntoViewIfNeeded();
  await expect(page.locator('.prompt-character-count')).toBeInViewport();
  await page.screenshot({ path: `test-results/h3-prompt-limit-${width}.png` });
});

for (const width of [1440, 390]) test(`keeps the multi-line draft and layout stable when timing does not fit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const draft = 'She holds a rock and asks "A rock?", then sets it down, lifts a bowl and asks "Old vegetables?"';
  const prompt = page.getByLabel('Video prompt');
  await prompt.fill(draft);
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    expect(route.request().postDataJSON().prompt).toBe(draft);
    await waiting;
    await route.fulfill({ status: 422, json: { error: 'This sequence needs about 9 seconds for its dialogue and actions. Increase the duration or split it into shorter clips, then enhance again. Your draft has been kept.' } });
  });
  const enhance = page.getByRole('button', { name: 'Enhance prompt', exact: true });
  await enhance.scrollIntoViewIfNeeded();
  const before = await prompt.boundingBox();
  await enhance.click();
  await expect(page.getByRole('button', { name: 'Enhancing…', exact: true })).toBeDisabled();
  expect(await prompt.boundingBox()).toEqual(before);
  finish();
  await expect(page.getByRole('alert')).toContainText('Increase the duration or split it');
  await expect(prompt).toHaveValue(draft);
  await expect(enhance).toBeEnabled();
  expect(await prompt.boundingBox()).toEqual(before);
});
