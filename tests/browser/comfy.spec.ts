import { expect, test, openVideo, addBridge, readProject, saveAndReopen, fitAll } from './fixtures';
import { generationProgress } from '../../server/features/comfy/progress';
import { ComfyNodeProgress } from '../../server/features/comfy/node-progress';

for (const width of [1440,390]) for (const detailed of [true, false]) test(`mocked Comfy generation, status recovery, and regeneration with ${detailed ? 'detailed' : 'aggregate-only'} progress at ${width}px`, { tag: ['@generation', '@slow'] }, async ({ page }) => {
  await page.setViewportSize({width,height:width===390?844:1000});
  await page.route('**/api/status', async route => { const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { openai: false, gemini: false, comfy: true } } }); });
  await page.route('**/api/comfy/status', route => route.fulfill({ json: { ready: true } }));
  let complete = false, failStatus = false, comfySubmissions = 0, statusReads = 0;
  const aggregate = generationProgress({ value: .9892857142857142, nodes_done: 27, nodes_total: 28 });
  const progress = detailed ? new ComfyNodeProgress('comfy-test-job').read(JSON.stringify({ type: 'progress', data: { prompt_id: 'comfy-test-job', node: 'sample', value: 7, max: 20 } }))!
    : { type: 'progress', ...aggregate };
  const displayed = detailed ? .35 : -1;
  const label = detailed ? '35% of stage · Generating video and audio · step 7/20' : 'Generating scene';
  await page.route('**/api/comfy/jobs/comfy-test-job/events', route => route.fulfill({ contentType: 'text/event-stream',
    body: `event: progress\ndata: ${JSON.stringify(progress)}\n\n` }));
  await page.route('**/api/comfy/interstitials', async route => {
    comfySubmissions++;
    const form = await new Response(Uint8Array.from(route.request().postDataBuffer()!), { headers: { 'Content-Type': route.request().headers()['content-type'] } }).formData();
    expect(form.get('before')).toBe('1.625'); expect(form.get('after')).toBe('1.625'); expect(form.get('duration')).toBe('6');
    expect(form.get('prompt')).toBe('Continue the motion'); expect((form.get('video') as File).size).toBeGreaterThan(1000);
    expect(form.get('maskInjection')).toBe('standard');
    expect(form.get('audioMaskTransitionMs')).toBe(comfySubmissions === 1 ? '250' : '0');
    expect(form.get('videoMaskTransitionMs')).toBe('1000');
    expect(form.has('maskTransitionMs')).toBe(false);
    expect(form.has('interpolateMiddle')).toBe(false);
    await route.fulfill({ status: 202, json: { requestId: 'comfy-test-job', status: 'IN_QUEUE', insertion: { start: 39 / 24, duration: 148 / 24, totalDuration: 226 / 24 } } });
  });
  await page.route('**/api/comfy/jobs/comfy-test-job', route => { statusReads++; return failStatus
    ? route.fulfill({ status: 500, json: { error: 'The request failed. Please try again.' } })
    : route.fulfill({ json: complete
      ? { requestId: 'comfy-test-job', status: 'COMPLETED', videoUrl: '/api/comfy/assets/comfy-test-asset/content' }
      : { requestId: 'comfy-test-job', status: 'IN_PROGRESS', ...(detailed ? aggregate : {}) } }); });
  await openVideo(page);
  const bytes = await page.evaluate(async () => {
    const { Output, BufferTarget, Mp4OutputFormat, CanvasSource } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const canvas = new OffscreenCanvas(160, 96), ctx = canvas.getContext('2d')!;
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    const video = new CanvasSource(canvas, { codec: 'avc', fullCodecString: 'avc1.42001e', bitrate: 100_000 });
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
  await addBridge(page);
  await page.getByRole('group', { name: 'End reference', exact: true }).getByRole('button', { name: 'Video', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Video generation method' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Prompt expansion' })).toHaveCount(0);
  await page.getByLabel('Video prompt').fill('Continue the motion');
  await expect(page.locator('.inspector-references-panel')).toHaveAttribute('open', '');
  await page.getByText('Simple transition durations',{exact:true}).click();
  const audioTransition = page.getByRole('spinbutton', { name: 'Audio mask transition duration', exact: true });
  const videoTransition = page.getByRole('spinbutton', { name: 'Video mask transition duration', exact: true });
  await expect(audioTransition).toHaveValue('500');
  await expect(videoTransition).toHaveValue('500');
  await audioTransition.fill('250');
  await expect(videoTransition).toHaveValue('500');
  await videoTransition.fill('1000');
  await expect(audioTransition).toHaveValue('250');
  const mask = page.getByRole('button', { name: 'Edit video mask', exact: true });
  await expect(mask).toBeVisible();
  await expect(page.getByRole('button', { name: /^Mask injection:/ })).toHaveCount(0);
  await expect(page.getByText(/FILM \+/)).toHaveCount(0);
  const controls = () => page.locator('.interstitial-editor').evaluate(form => {
    const top=form.getBoundingClientRect().top;
    return ['textarea','.interstitial-time-fields','button[type=submit]','.task-status','input[aria-label="Audio mask transition duration"]','input[aria-label="Video mask transition duration"]'].map(selector=>{
      const bounds=form.querySelector(selector)!.getBoundingClientRect();return {top:bounds.top-top,height:bounds.height};
    });
  });
  const idleControls=await controls();
  const optionPosition = () => mask.evaluate(element => element.getBoundingClientRect().top - element.closest('form')!.getBoundingClientRect().top);
  const optionTop = await optionPosition();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Generating video' })).toHaveJSProperty('position', displayed, { timeout: 60_000 });
  await expect.poll(() => statusReads).toBeGreaterThanOrEqual(2);
  expect(await optionPosition()).toBeCloseTo(optionTop, 0);
  expect(await controls()).toEqual(idleControls);
  await expect(page.locator('.story-clip .timeline-generation-spinner')).toHaveCount(1);
  await expect(page.locator('.task-status')).toContainText(label);
  await expect(page.locator('.task-status')).not.toContainText(/98%|99%|reported by Comfy|estimated overall/);
  await expect(page.locator('.story-clip [role=status]')).toHaveAttribute('aria-label', new RegExp(detailed ? '35% of stage.*step 7/20' : 'Generating scene'));
  const percentageFits = () => page.locator('.task-status-message').evaluate(element => {
    const text = element.firstChild!, range = document.createRange();
    range.setStart(text, 0); range.setEnd(text, text.textContent!.indexOf('%') + 1);
    const percent = range.getBoundingClientRect(), message = element.getBoundingClientRect();
    return percent.left >= message.left && percent.right <= message.right - 12;
  });
  await page.locator('.task-status-message').scrollIntoViewIfNeeded();
  await expect(page.locator('.task-status-message')).toBeInViewport();
  if(detailed)expect(await percentageFits()).toBe(true);
  else await expect(page.locator('.task-status-message')).not.toContainText('%');
  await page.screenshot({ path: `test-results/comfy-progress-${detailed ? 'detailed' : 'aggregate'}-${width}.png` });
  failStatus = true;
  await expect(page.locator('.task-status')).toContainText('The request failed. Please try again.');
  expect(await optionPosition()).toBeCloseTo(optionTop, 0);
  expect(await controls()).toEqual(idleControls);
  await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled();
  failStatus = false;
  await page.getByRole('button', { name: 'Check result', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Generating video' })).toHaveJSProperty('position', displayed);
  expect(comfySubmissions).toBe(1);
  await expect(page.locator('.task-status')).toContainText(label);
  complete = true;
  await expect(page.locator('.task-status')).toContainText('Downloading generated video');
  await expect(page.getByRole('progressbar', { name: 'Generating video' })).toHaveJSProperty('position', -1);
  releaseDownload();
  const saved = async () => (await readProject(page)).interstitials[0];
  await expect.poll(async () => (await saved()).phase, { timeout: 60_000 }).toBe('ready');
  expect((await saved()).result.duration).toBe(148 / 24);
  expect((await saved()).requestMethod).toBe('comfy');
  expect((await saved()).generationSettings.maskInjection).toBe('standard');
  expect((await saved()).generationSettings).toMatchObject({ audioMaskTransitionMs: 250, videoMaskTransitionMs: 1000 });
  expect(await optionPosition()).toBeCloseTo(optionTop, 0);
  expect(await controls()).toEqual(idleControls);
  await expect(page.locator('.inspector-clip-meta')).toContainText('Generated');
  await expect(page.locator('.story-clip.type-simple')).toHaveCount(1);
  await page.locator('.inspector-output > summary').click();
  const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download full video' }).click(); await download;
  await page.screenshot({ path: `test-results/comfy-interstitial-${detailed ? 'detailed' : 'aggregate'}-${width}.png` });
  await audioTransition.fill('0');
  await expect(videoTransition).toHaveValue('1000');
  await expect(page.locator('.interstitial-edited')).toHaveText('Edited');
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  // Regeneration prepares real reference media before reaching the mocked provider.
  await expect.poll(async () => comfySubmissions, { timeout: 60_000 }).toBe(2);
  await expect.poll(async () => (await saved()).phase, { timeout: 60_000 }).toBe('ready');
  expect((await saved()).result.duration).toBe(148 / 24);
  expect((await saved()).requestMethod).toBe('comfy');
  expect((await saved()).generationSettings.maskInjection).toBe('standard');
  expect((await saved()).generationSettings).toMatchObject({ audioMaskTransitionMs: 0, videoMaskTransitionMs: 1000 });
  await saveAndReopen(page);
  await fitAll(page);
  await page.locator('.story-clip.type-simple .story-clip-title').click();
  await expect(page.locator('.inspector-references-panel')).toHaveAttribute('open', '');
  await page.getByText('Simple transition durations', { exact: true }).click();
  await expect(audioTransition).toHaveValue('0');
  await expect(videoTransition).toHaveValue('1000');
});
