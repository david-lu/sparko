import { test, expect, addDraft, readProject, saveAndReopen, type Page } from './fixtures';

const controls = (page: Page) => page.locator('.interstitial-editor').evaluate(root => {
  const top = root.getBoundingClientRect().top;
  return ['textarea', '.image-references', '.interstitial-resolution', '.interstitial-time-fields', 'button[type=submit]', '.task-status'].map(selector => {
    const rect = root.querySelector(selector)!.getBoundingClientRect(); return { top: rect.top - top, height: rect.height };
  });
});

for (const loop of [false, true]) for (const width of [1440, 390]) test(`H3 images guide ${loop ? 'loop' : 'scene'} enhancement and generation with stable loading at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/status', async route => {
    const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { openai: true, comfy: true, gemini: false } } });
  });
  await page.goto('/'); await page.getByRole('button', { name: /^New project/ }).click(); await addDraft(page);
  await page.getByRole('group', { name: 'Start reference', exact: true }).getByRole('button', { name: 'None', exact: true }).click();
  await page.getByRole('group', { name: 'End reference', exact: true }).getByRole('button', { name: 'None', exact: true }).click();
  if (loop) {
    await page.getByRole('checkbox', { name: 'Loop', exact: true }).check();
    await page.getByRole('group', { name: 'Loop reference', exact: true }).getByRole('button', { name: 'Image', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Loop reference', exact: true }).getByRole('button', { name: 'Image', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('group', { name: 'Start reference', exact: true })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'End reference', exact: true })).toHaveCount(0);
    const beforeHelp = await controls(page);
    await page.getByRole('button', { name: 'About loop references', exact: true }).click();
    const help = page.getByRole('dialog', { name: 'Loop reference help' });
    await expect(help).toBeVisible(); await expect(help).toContainText('first and last frames');
    await expect(help).toContainText('regenerate'); expect(await controls(page)).toEqual(beforeHelp);
    const box = await help.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape'); await expect(help).toBeHidden(); expect(await controls(page)).toEqual(beforeHelp);
  }
  if (!loop) for (const side of ['Start', 'End']) await page.getByRole('group', { name: `${side} reference`, exact: true }).getByRole('button', { name: 'Image', exact: true }).click();
  const prompt = page.getByLabel('Interstitial prompt', { exact: true }); await prompt.fill('Animate the subject in <Picture 1> using the colors of <Picture 2>.');
  const pngs = await page.evaluate(() => ['red', 'blue'].map(color => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 192;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 320, 192); return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.evaluate(() => {
    const original = window.createImageBitmap, gate = new Promise<void>(resolve => { (window as any).finishImages = resolve; });
    window.createImageBitmap = (async (...args: any[]) => { await gate; return (original as any)(...args); }) as typeof original;
  });
  const before = await controls(page);
  await page.getByLabel('Choose image references', { exact: true }).setInputFiles(pngs.map((png, index) => ({ name: `reference-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
  await expect(page.getByRole('button', { name: 'Adding…', exact: true })).toBeDisabled();
  expect(await controls(page)).toEqual(before);
  await page.evaluate(() => (window as any).finishImages());
  await expect(page.locator('.image-reference-list img')).toHaveCount(2); expect(await controls(page)).toEqual(before);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('.image-reference-list img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(page.locator('.image-reference-list img')).toHaveCount(2);
  if (!loop) await page.getByLabel('End reference image', { exact: true }).selectOption('1');
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();

  let finishEnhancement!: () => void, enhancedRequests = 0;
  const enhancing = new Promise<void>(resolve => { finishEnhancement = resolve; });
  const enhanced = 'The subject from <Picture 1> moves gently in one uninterrupted shot, using the blue palette from <Picture 2>.';
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    const body = route.request().postDataJSON(); enhancedRequests++;
    if (loop) expect(body.kind).toBe('idle');
    expect(body.imageGuides).toEqual({ start: 0, end: loop ? 0 : 1 }); expect(body.referenceFrames).toEqual([]); expect(body.imageReferences).toHaveLength(2);
    expect(body.imageReferences[0]).not.toBe(body.imageReferences[1]);
    for (const image of body.imageReferences) { expect(image).toMatch(/^data:image\/jpeg;base64,/); expect(image.length).toBeLessThanOrEqual(32_000); }
    await enhancing; await route.fulfill({ json: { prompt: enhanced, model: 'test' } });
  });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect.poll(() => enhancedRequests).toBe(1); expect(await controls(page)).toEqual(before);
  finishEnhancement(); await expect(prompt).toHaveValue(enhanced); expect(await controls(page)).toEqual(before);

  let complete = false, submitted = 0;
  await page.route('**/api/comfy/status*', route => {
    if (loop) expect(new URL(route.request().url()).searchParams.get('imageLoop')).toBe('true');
    expect(new URL(route.request().url()).searchParams.get('imageReferences')).toBe('true'); return route.fulfill({ json: { ready: true } });
  });
  await page.route('**/api/comfy/interstitials', async route => {
    const body = await new Response(Uint8Array.from(route.request().postDataBuffer()!), { headers: { 'Content-Type': route.request().headers()['content-type'] } }).formData();
    expect(JSON.parse(String(body.get('imageReferences')))).toHaveLength(2); expect(body.has('video')).toBe(false);
    expect(body.get('width')).toBe('320'); expect(body.get('height')).toBe('192'); expect(body.get('before')).toBe('0'); expect(body.get('after')).toBe('0');
    expect(body.get('startImageIndex')).toBe('0'); expect(body.get('endImageIndex')).toBe(loop ? '0' : '1');
    expect(body.get('prompt')).toBe(enhanced); submitted++;
    expect(body.get('mode')).toBe(loop ? 'loop' : 'custom');
    await route.fulfill({ status: 202, json: { requestId: 'image-reference-job', status: 'IN_QUEUE', insertion: { start: 0, duration: 4, totalDuration: 4 } } });
  });
  await page.route('**/api/comfy/jobs/image-reference-job/events', route => route.fulfill({ contentType: 'text/event-stream', body: 'event: progress\ndata: {"type":"progress","progressDetails":{"stage":"Encoding image references"}}\n\n' }));
  await page.route('**/api/comfy/jobs/image-reference-job', route => route.fulfill({ json: complete
    ? { requestId: 'image-reference-job', status: 'COMPLETED', videoUrl: 'https://example.test/image-reference.mp4' }
    : { requestId: 'image-reference-job', status: 'IN_PROGRESS', progressDetails: { stage: 'Encoding image references' } } }));
  await page.route('https://example.test/image-reference.mp4', route => route.fulfill({ contentType: 'video/mp4', path: 'tests/fixtures/interstitial-reference.mp4' }));
  await page.getByRole('button', { name: 'Generate', exact: true }).click(); await expect.poll(() => submitted).toBe(1);
  expect(await controls(page)).toEqual(before);
  await page.getByRole('button', { name: 'Remove Picture 2', exact: true }).click(); expect(await controls(page)).toEqual(before);
  complete = true; await expect.poll(async () => ['ready', 'error'].includes((await readProject(page))!.interstitials[0].phase), { timeout: 60_000 }).toBe(true);
  expect((await readProject(page))!.interstitials[0]).toMatchObject({ phase: 'ready', error: undefined });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  expect(await controls(page)).toEqual(before);
  const item = (await readProject(page))!.interstitials[0]; expect(item.imageReferences).toHaveLength(1); expect(item.generationSettings!.imageReferences).toHaveLength(2);
  if (loop) expect(item.result.reference).toEqual({ mode: 'loop' });

  await page.getByLabel('Choose image references', { exact: true }).setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.locator('.image-reference-feedback')).toContainText('Unable to read'); expect(await controls(page)).toEqual(before);
  await page.locator('.image-references').scrollIntoViewIfNeeded(); await page.screenshot({ path: `test-results/image-references-${loop ? 'loop' : 'scene'}-${width}.png` });
  await saveAndReopen(page); await page.locator('.story-clip-title').click(); await expect(page.locator('.image-reference-list img')).toHaveCount(1);
  expect((await readProject(page))!.interstitials[0].generationSettings!.imageReferences).toHaveLength(2);
  if (loop) {
    expect((await readProject(page))!.interstitials[0].result.reference).toEqual({ mode: 'loop' });
    await expect(page.getByRole('group', { name: 'Loop reference', exact: true }).getByRole('button', { name: 'Image', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('checkbox', { name: 'Loop', exact: true }).uncheck();
    await expect(page.getByRole('group', { name: 'End reference', exact: true }).getByRole('button', { name: 'None', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  expect(errors).toEqual([]);
});

test('changing images cancels enhancement and ignores its late response', async ({ page }) => {
  await page.route('**/api/status', async route => { const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { openai: true, comfy: true, gemini: false } } }); });
  await page.goto('/'); await page.getByRole('button', { name: /^New project/ }).click(); await addDraft(page);
  const prompt = page.getByLabel('Interstitial prompt', { exact: true }); await prompt.fill('Use <Picture 1> for the subject.');
  await page.getByRole('group', { name: 'Start reference', exact: true }).getByRole('button', { name: 'None', exact: true }).click();
  await page.getByLabel('Choose image references', { exact: true }).setInputFiles('src/app/tutorial/images/save.png');
  await expect(page.locator('.image-reference-list img')).toHaveCount(1);
  let finish!: () => void, requests = 0; const gate = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/interstitials/enhance-prompt', async route => { requests++; await gate; await route.fulfill({ json: { prompt: 'An outdated image description', model: 'test' } }).catch(() => undefined); });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click(); await expect.poll(() => requests).toBe(1);
  await page.getByRole('button', { name: 'Remove Picture 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeEnabled(); finish();
  await expect(prompt).toHaveValue('Use <Picture 1> for the subject.');
});
