import { test, expect, openVideo, addBridge, readProject, type Page } from './fixtures';
const openTimeline = (page: Page) => page.getByRole('button', { name: 'Edit generation timeline', exact: true }).click();
const closeTimeline = (page: Page) => page.getByRole('button', { name: 'Close generation timeline', exact: true }).click();
const layout = (page: Page, editor: boolean) => page.locator(editor ? '.generation-timeline-editor' : '.interstitial-editor').evaluate((root, editor) => {
  const top = root.getBoundingClientRect().top;
  return (editor ? ['.generation-player', '.generation-timeline-toolbar', '.generation-timeline-scroll'] : ['.generation-timeline-summary', '.interstitial-upscale', 'button[type=submit]']).map(selector => {
    const rect = root.querySelector(selector)!.getBoundingClientRect(); return { top: rect.top - top, height: rect.height };
  });
}, editor);

for (const width of [1440, 390]) test(`keyframe upload and enhancement keep layout stable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/status', async route => { const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { openai: true, comfy: true, gemini: false } } }); });
  await openVideo(page); await addBridge(page);
  await page.getByLabel('Video prompt', { exact: true }).fill('Lift the rock.');
  await openTimeline(page);
  await page.getByRole('button', { name: 'Add image keyframe', exact: true }).click();
  await page.getByLabel('Keyframe frame', { exact: true }).fill('87');
  const before = await layout(page, true);
  await page.evaluate(() => {
    const original = window.createImageBitmap, gate = new Promise<void>(resolve => { (window as any).finishImage = resolve; });
    window.createImageBitmap = (async (...args: any[]) => { await gate; return (original as any)(...args); }) as typeof original;
  });
  await page.getByLabel('Upload Keyframe image', { exact: true }).setInputFiles('src/app/tutorial/images/save.png');
  await expect(page.getByRole('group', { name: 'Keyframe image', exact: true })).toHaveAttribute('aria-busy', 'true');
  expect(await layout(page, true)).toEqual(before);
  await page.evaluate(() => (window as any).finishImage());
  await expect(page.getByRole('group', { name: 'Keyframe image', exact: true })).toHaveAttribute('aria-busy', 'false');
  expect(await layout(page, true)).toEqual(before);
  await closeTimeline(page);
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).scrollIntoViewIfNeeded();
  const idle = await layout(page, false);
  let finish!: () => void, sent = 0; const gate = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    const body = route.request().postDataJSON(); expect(body.keyframes[0].frame).toBe(48); expect(body.keyframes[0].image).toMatch(/^data:image\/jpeg;base64,/); sent++;
    await gate; await route.fulfill({ json: { prompt: 'Hold the rock at chest height.', model: 'test' } });
  });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click(); await expect.poll(() => sent).toBe(1);
  expect(await layout(page, false)).toEqual(idle); finish();
  await expect(page.getByLabel('Enhanced prompt', { exact: true })).toHaveValue('Hold the rock at chest height.');
  expect(await layout(page, false)).toEqual(idle);
  await openTimeline(page);
  await page.getByRole('button', { name: 'Add image keyframe', exact: true }).click();
  await page.getByRole('button', { name: 'Choose Keyframe image from Library', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose Keyframe image from Library', exact: true });
  await picker.getByRole('button', { name: 'save.png', exact: true }).click(); await picker.getByRole('button', { name: 'Use asset', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await page.getByLabel('Keyframe frame', { exact: true }).fill('87'); await closeTimeline(page);
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  await openTimeline(page);
  await page.getByLabel('Selected generation input', { exact: true }).selectOption({ index: 2 });
  await page.locator('.video-keyframe-footer').getByRole('checkbox', { name: 'Enabled', exact: true }).uncheck();
  await closeTimeline(page);
  await page.getByLabel('Prompt used for generation', { exact: true }).selectOption('original');
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
  expect((await readProject(page)).interstitials[0].keyframes[1].enabled).toBe(false); expect(errors).toEqual([]);
});

test('changing a timed image cancels enhancement and shortening duration preserves invalid positions for correction', async ({ page }) => {
  await page.route('**/api/status', async route => { const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { openai: true, comfy: true, gemini: false } } }); });
  await openVideo(page); await addBridge(page);
  const prompt = page.getByLabel('Video prompt', { exact: true }); await prompt.fill('She lifts a rock.');
  await openTimeline(page); await page.getByRole('button', { name: 'Add image keyframe', exact: true }).click();
  await page.getByLabel('Upload Keyframe image', { exact: true }).setInputFiles('src/app/tutorial/images/save.png');
  await expect(page.getByRole('group', { name: 'Keyframe image', exact: true })).toHaveAttribute('aria-busy', 'false');
  await closeTimeline(page);
  let finish!: () => void, sent = false; const gate = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/interstitials/enhance-prompt', async route => { sent = true; await gate; await route.fulfill({ json: { prompt: 'Old timing', model: 'test' } }).catch(() => {}); });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click(); await expect.poll(() => sent).toBe(true);
  await openTimeline(page); await page.getByLabel('Selected generation input', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Keyframe frame', { exact: true }).fill('120'); finish();
  await page.getByLabel('Duration', { exact: true }).fill('3');
  await expect(page.locator('.video-keyframe-error')).toContainText('Outside the generated section');
  await expect(page.getByLabel('Keyframe frame', { exact: true })).toHaveValue('120');
  await closeTimeline(page); await expect(prompt).toHaveValue('She lifts a rock.');
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
});
