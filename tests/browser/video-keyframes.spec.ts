import { test, expect, openVideo, addBridge, readProject, saveAndReopen, type Page } from './fixtures';

const layout = (page: Page) => page.locator('.interstitial-editor').evaluate(root => {
  const top = root.getBoundingClientRect().top;
  return ['.video-keyframe-time', '.video-keyframe-footer', '.mask-curve-control', '.interstitial-resolution', 'button[type=submit]'].map(selector => {
    const rect = root.querySelector(selector)!.getBoundingClientRect(); return { top: rect.top - top, height: rect.height };
  });
});
const uploadImage = async (page: Page) => {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 192;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#446a84'; ctx.fillRect(0, 0, 320, 192);
    ctx.fillStyle = '#e9c496'; ctx.fillRect(100, 50, 50, 100); return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Upload Keyframe image', { exact: true }).setInputFiles({ name: 'pose.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
};

for (const width of [1440, 390]) test(`timed image keyframes, masks and generation work at ${width}px without loading shifts`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/status', async route => {
    const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { openai: true, comfy: true, gemini: false } } });
  });
  await openVideo(page); await addBridge(page);
  await page.getByLabel('Video prompt', { exact: true }).fill('Lift the rock, then put it down.');
  await page.getByRole('button', { name: 'Add image keyframe', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  await page.getByLabel('Keyframe time in seconds', { exact: true }).fill('3.625');
  await expect(page.getByLabel('Keyframe frame', { exact: true })).toHaveValue('87');
  await expect(page.locator('.video-keyframe-footer')).toContainText('Generated: 2.000s · frame 48');
  const before = await layout(page);
  await page.evaluate(() => {
    const original = window.createImageBitmap, gate = new Promise<void>(resolve => { (window as any).finishKeyframe = resolve; });
    window.createImageBitmap = (async (...args: any[]) => { await gate; return (original as any)(...args); }) as typeof original;
  });
  await uploadImage(page);
  await expect(page.getByRole('group', { name: 'Keyframe image', exact: true })).toHaveAttribute('aria-busy', 'true');
  expect(await layout(page)).toEqual(before);
  await page.evaluate(() => (window as any).finishKeyframe());
  await expect(page.getByRole('group', { name: 'Keyframe image', exact: true })).toContainText('pose.png');
  await expect(page.getByRole('group', { name: 'Keyframe image', exact: true })).toHaveAttribute('aria-busy', 'false');
  expect(await layout(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
  await page.locator('.video-keyframes').getByRole('button', { name: 'Preview pose.png', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Preview pose.png', exact: true }).locator('img')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edit audio mask', exact: true }).click();
  const mask = page.getByRole('dialog', { name: 'Generation timeline', exact: true });
  await expect(mask.getByRole('img', { name: 'Image guide pose.png at 3.625 seconds', exact: true })).toBeVisible();
  const box = (await mask.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
  await page.keyboard.press('Escape');

  let resolveEnhance!: () => void, requests = 0;
  const gate = new Promise<void>(resolve => { resolveEnhance = resolve; });
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    const body = route.request().postDataJSON(); requests++;
    expect(body.keyframes).toHaveLength(1); expect(body.keyframes[0].frame).toBe(48);
    expect(body.keyframes[0].image).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.imageReferences).toEqual([]); expect(body.referenceTiming.prefixFrames).toBe(39);
    await gate; await route.fulfill({ json: { prompt: 'Lift the rock by 3.625 seconds on the full-video clock.', model: 'test' } });
  });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect.poll(() => requests).toBe(1); expect(await layout(page)).toEqual(before);
  resolveEnhance(); await expect(page.getByLabel('Video prompt', { exact: true })).toHaveValue('Lift the rock by 3.625 seconds on the full-video clock.');
  expect(await layout(page)).toEqual(before);

  await page.getByRole('button', { name: 'Add image keyframe', exact: true }).click();
  await page.getByRole('button', { name: 'Choose Keyframe image from Library', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose Keyframe image from Library', exact: true });
  await picker.getByRole('button', { name: 'pose.png', exact: true }).click(); await picker.getByRole('button', { name: 'Use asset', exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByRole('group', { name: 'Keyframe image', exact: true })).toHaveAttribute('aria-busy', 'false');
  await page.getByLabel('Keyframe frame', { exact: true }).fill('87');
  await expect(page.getByLabel('Keyframe frame', { exact: true })).toHaveValue('87');
  await expect.poll(async () => (await readProject(page))!.interstitials[0].keyframes.map((k: any) => k.frame)).toEqual([48, 48]);
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  await page.locator('.video-keyframe-footer').getByRole('checkbox', { name: 'Enabled', exact: true }).uncheck();
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Delete image keyframe', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Selected image keyframe', exact: true }).locator('option')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Selected image keyframe', exact: true }).locator('option')).toHaveCount(2);

  let submitted = 0;
  await page.route('**/api/comfy/status*', route => { expect(new URL(route.request().url()).searchParams.get('imageGuides')).toBe('true'); return route.fulfill({ json: { ready: true } }); });
  await page.route('**/api/comfy/interstitials', async route => {
    const body = await new Response(Uint8Array.from(route.request().postDataBuffer()!), { headers: { 'Content-Type': route.request().headers()['content-type'] } }).formData();
    expect(JSON.parse(String(body.get('keyframes')))).toEqual([{ frame: 48, imageIndex: 0 }]);
    expect(JSON.parse(String(body.get('keyframeImages')))).toHaveLength(1);
    expect(body.has('imageReferences')).toBe(false); expect(body.has('video')).toBe(true); expect(body.get('before')).toBe('1.625');
    const origin = JSON.parse(String(body.get('clipOrigin'))); expect(origin.settings.keyframes).toHaveLength(2);
    submitted++; await route.fulfill({ status: 400, json: { error: 'Test render stopped before paid generation.' } });
  });
  const beforeGenerate = await layout(page);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect.poll(() => submitted).toBe(1);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  expect(await layout(page)).toEqual(beforeGenerate);
  await page.getByRole('button', { name: 'Collapse Library panel', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse Add clips panel', exact: true }).click();
  await page.locator('.video-keyframes').scrollIntoViewIfNeeded();
  expect(await page.locator('.video-keyframes').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.locator('.video-keyframes').screenshot({ path: `test-results/keyframes-${width}.png` });
  await saveAndReopen(page); await page.getByRole('button', { name: 'Select New scene', exact: true }).press('Enter');
  await expect(page.getByRole('combobox', { name: 'Selected image keyframe', exact: true }).locator('option')).toHaveCount(2);
  const saved = (await readProject(page))!.interstitials[0]; expect(saved.keyframes[0]).toMatchObject({ frame: 48, enabled: true });
  expect(saved.keyframes[1].enabled).toBe(false);
  await page.getByRole('button', { name: 'Expand Library panel', exact: true }).click();
  await page.getByRole('button', { name: 'Library asset pose.png', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete asset…', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Delete pose.png?', exact: true });
  await expect(deletion).toContainText('keyframe image');
  await deletion.getByRole('button', { name: 'Delete asset', exact: true }).click();
  await page.getByRole('button', { name: 'Select New scene', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeDisabled();
  await expect(page.locator('.video-keyframes').getByRole('button', { name: 'pose.png reference errors', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});


test('changing a timed image cancels enhancement, and shortening duration cannot silently move a keyframe', async ({ page }) => {
  await page.route('**/api/status', async route => {
    const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { openai: true, comfy: true, gemini: false } } });
  });
  await openVideo(page); await addBridge(page);
  const prompt = page.getByLabel('Video prompt', { exact: true }); await prompt.fill('She lifts a rock.');
  await page.getByRole('button', { name: 'Add image keyframe', exact: true }).click(); await uploadImage(page);
  await expect(page.getByRole('group', { name: 'Keyframe image', exact: true })).toHaveAttribute('aria-busy', 'false');
  let resolve!: () => void, sent = false;
  const gate = new Promise<void>(finish => { resolve = finish; });
  await page.route('**/api/interstitials/enhance-prompt', async route => { sent = true; await gate; await route.fulfill({ json: { prompt: 'Old timing', model: 'test' } }).catch(() => {}); });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click(); await expect.poll(() => sent).toBe(true);
  await page.getByLabel('Keyframe frame', { exact: true }).fill('120');
  await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeEnabled(); resolve();
  await expect(prompt).toHaveValue('She lifts a rock.');
  await page.getByLabel('Duration', { exact: true }).fill('3');
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  await expect(page.locator('.video-keyframe-error')).toContainText('Outside the generated section');
  await expect(page.getByLabel('Keyframe frame', { exact: true })).toHaveValue('120');
  await page.locator('.video-keyframe-footer').getByRole('checkbox', { name: 'Enabled', exact: true }).uncheck();
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
  expect(await page.locator('.interstitial-editor form').evaluate((form: HTMLFormElement) => form.checkValidity())).toBe(true);
  await page.locator('.video-keyframe-footer').getByRole('checkbox', { name: 'Enabled', exact: true }).check();
  await page.getByLabel('Keyframe frame', { exact: true }).fill('24');
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
});
