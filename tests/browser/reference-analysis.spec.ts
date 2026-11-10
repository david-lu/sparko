import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';
import { openGenerationTimeline, closeGenerationTimeline, setVideoReference, test, expect, openVideo, addBridge, saveAndReopen } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/status', async route => {
    const status = await (await route.fetch()).json();
    await route.fulfill({ json: { ...status, providers: { ...status.providers, openai: true, gemini: true, comfy: true } } });
  });
  await openVideo(page); await addBridge(page);
  await setVideoReference(page, 'end', true);
  await page.getByLabel('Video prompt').fill('She waves and asks "Ready?"');
});

for (const width of [1440, 390]) test(`analyzes the actual start/end windows for Enhance and Edit without shifting controls at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const option = page.getByRole('checkbox', { name: 'Analyze reference videos with AI' });
  await expect(option).not.toBeChecked(); await option.check();
  const prompt = page.getByLabel('Video prompt'), enhancedField = page.getByLabel('Enhanced prompt', { exact: true });
  const enhanced = 'She waves and asks <d>[English] Ready?</d>.';
  const edited = { prompt: 'She waves and brightly asks "Ready?"', enhancedPrompt: 'She waves and brightly asks <d>[English] Ready?</d>.' };
  let finish!: () => void, gate = new Promise<void>(resolve => { finish = resolve; });
  let analyses = 0, enhancements = 0;
  const descriptions = ['0–1.625s: She lowers her hand; music continues.', '0–1.625s: She waits with her hands at her waist.'];
  await page.route('**/api/analyze/gemini', async route => {
    const index = analyses++;
    const form = await new Response(Uint8Array.from(route.request().postDataBuffer()!), { headers: { 'Content-Type': route.request().headers()['content-type'] } }).formData();
    expect(form.get('purpose')).toBe('reference-timing');
    expect(form.get('start')).toBe('0'); expect(form.get('end')).toBe('1.625');
    expect(form.get('instructions')).toContain(`${index % 2 ? 'end' : 'start'} reference`);
    const input = new Input({ source: new BlobSource(form.get('media') as Blob), formats: ALL_FORMATS });
    try { expect(await (await input.getPrimaryVideoTrack())!.computeDuration()).toBeCloseTo(1.625, 3); expect(await input.getPrimaryAudioTrack()).not.toBeNull(); }
    finally { input.dispose(); }
    if (index % 2 === 0) await gate;
    await route.fulfill({ json: { description: descriptions[index % 2], caption: 'Reference', start: 0, end: 1.625, model: 'test', provider: 'gemini', basis: 'Video and audio' } });
  });
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    const body = route.request().postDataJSON();
    expect(body.referenceTiming).toEqual({ prefixFrames: 39, suffixFrames: 39 });
    expect(body.referenceDescriptions).toEqual(descriptions.map((description, index) => ({ side: index ? 'end' : 'start', frames: 39, description })));
    expect(body.referenceAudioMask.start).toBeDefined();
    if (!enhancements++) return route.fulfill({ json: { prompt: enhanced, model: 'test' } });
    // Once an enhanced version exists, Edit with AI rewrites both versions together.
    expect(body.editInstructions).toBe('Make the question brighter.'); expect(body.enhancedPrompt).toBe(enhanced);
    await route.fulfill({ json: { ...edited, model: 'test' } });
  });
  const layout = () => page.locator('.interstitial-editor').evaluate(root => {
    const top = root.getBoundingClientRect().top;
    return ['textarea', '.prompt-character-count', '.generation-timeline-summary', 'button[type=submit]'].map(selector => {
      const box = root.querySelector(selector)!.getBoundingClientRect(); return { top: box.top - top, height: box.height };
    });
  });
  const enhance = page.getByRole('button', { name: 'Enhance prompt', exact: true });
  await enhance.scrollIntoViewIfNeeded(); const idle = await layout();
  await enhance.click(); await expect.poll(() => analyses, { timeout: 60000 }).toBe(1);
  await expect(page.getByRole('button', { name: 'Analyzing…', exact: true })).toBeDisabled();
  expect(await layout()).toEqual(idle);
  await page.screenshot({ path: `test-results/reference-analysis-${width}-loading.png` });
  // Enhancing fills the separate enhanced version and keeps the original draft.
  finish(); await expect(enhancedField).toHaveValue(enhanced); await expect(prompt).toHaveValue('She waves and asks "Ready?"');
  expect(analyses).toBe(2); expect(await layout()).toEqual(idle);
  gate = new Promise<void>(resolve => { finish = resolve; });
  await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit prompt with AI' });
  await dialog.getByLabel('What should change?').fill('Make the question brighter.');
  const dialogBox = await dialog.boundingBox();
  await dialog.getByRole('button', { name: 'Apply edit' }).click();
  await expect.poll(() => analyses, { timeout: 60000 }).toBe(3);
  await expect(dialog.getByRole('status')).toContainText('Analyzing reference videos');
  expect(await dialog.boundingBox()).toEqual(dialogBox); expect(await layout()).toEqual(idle);
  finish(); await expect(dialog).toHaveCount(0); expect(enhancements).toBe(2); expect(analyses).toBe(4);
  await expect(prompt).toHaveValue(edited.prompt); await expect(enhancedField).toHaveValue(edited.enhancedPrompt);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  // Persistence is checked once, at full width.
  if (width === 1440) {
    await saveAndReopen(page); await page.locator('.story-clip.type-simple .story-clip-title').click();
    await expect(option).toBeChecked();
  }
});

test('keeps the draft on analysis failure, cancellation and reference changes; skips disabled references', async ({ page }) => {
  const option = page.getByRole('checkbox', { name: 'Analyze reference videos with AI' }); await option.check();
  const prompt = page.getByLabel('Video prompt'), original = await prompt.inputValue();
  const enhancedField = page.getByLabel('Enhanced prompt', { exact: true });
  const enhance = page.getByRole('button', { name: 'Enhance prompt', exact: true });
  let analyses = 0, enhancements = 0, finish!: () => void;
  let gate = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/analyze/gemini', async route => {
    if (++analyses === 1) return route.fulfill({ status: 502, json: { error: 'Cannot analyze this video.' } });
    await gate;
    await route.fulfill({ json: { description: 'She waits.', caption: 'Wait', start: 0, end: 1.625, provider: 'gemini', model: 'test', basis: 'Video' } }).catch(() => {});
  });
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    enhancements++;
    expect(route.request().postDataJSON()).toMatchObject({ referenceTiming: { prefixFrames: 0, suffixFrames: 0 } });
    expect(route.request().postDataJSON()).not.toHaveProperty('referenceDescriptions');
    await route.fulfill({ json: { prompt: 'A wave.', model: 'test' } });
  });
  await enhance.click();
  // Preparing the reference video uses software encoding on CI. Wait for the
  // request before measuring how quickly the UI reports its mocked failure.
  await expect.poll(() => analyses, { timeout: 60000 }).toBe(1);
  await expect(page.getByRole('alert')).toContainText('Could not analyze the start reference');
  await expect(prompt).toHaveValue(original); expect(enhancements).toBe(0);
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await enhance.click(); await expect.poll(() => analyses, { timeout: 60000 }).toBe(2);
  await page.getByRole('button', { name: 'Cancel prompt enhancement' }).click(); finish();
  await expect(enhance).toBeEnabled(); await expect(prompt).toHaveValue(original);
  gate = new Promise<void>(resolve => { finish = resolve; });
  await enhance.click(); await expect.poll(() => analyses, { timeout: 60000 }).toBe(3);
  await openGenerationTimeline(page); await page.getByRole('spinbutton', { name: 'start_range', exact: true }).fill('1.75'); await closeGenerationTimeline(page);
  await expect(enhance).toBeEnabled(); finish();
  await expect(prompt).toHaveValue(original); await expect(enhancedField).toHaveValue(''); expect(enhancements).toBe(0);
  for (const side of ['start', 'end'] as const) await setVideoReference(page, side, false);
  // Enhancing fills the separate enhanced version and keeps the original draft.
  await enhance.click(); await expect(enhancedField).toHaveValue('A wave.'); await expect(prompt).toHaveValue(original); expect(analyses).toBe(3);
});
