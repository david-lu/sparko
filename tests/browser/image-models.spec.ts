import { test, expect, openVideo, readProject, dragIntoView, addDraft, type Page } from './fixtures';

async function setup(page: Page) {
  await page.route('**/api/status', async route => { const response = await route.fetch(), status = await response.json(); await route.fulfill({ json: { ...status, providers: { ...status.providers, fal: true, openai: true } } }); });
  await openVideo(page);
}
async function create(page: Page) {
  await page.getByRole('button',{name:'Add image',exact:true}).press('Enter');
}
async function importImage(page: Page, name = 'Reference.png') {
  const base64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 160; c.height = 90; const ctx = c.getContext('2d')!; ctx.fillStyle = '#dfab69'; ctx.fillRect(0, 0, 160, 90); return c.toDataURL().split(',')[1]; });
  const file = { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
  await page.getByLabel('Import library assets', { exact: true }).setInputFiles(file);
  await expect(page.getByRole('button', { name: `Library asset ${name}`, exact: true })).toBeVisible();
  return file;
}
const positions = (page: Page) => page.locator('.clip-generation-editor').evaluate(root => ['.prompt-field-heading', 'textarea', '.asset-input', 'button[type=submit]'].map(selector => { const r = root.querySelector(selector)!.getBoundingClientRect(); return { y: r.top - root.getBoundingClientRect().top, height: r.height }; }));

for (const width of [1440, 390]) test(`image enhancement follows the selected model and keeps the Inspector stable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await setup(page); await importImage(page); await create(page);
  const model = page.getByLabel('Generation model', { exact: true }), prompt = page.getByLabel('Generation prompt', { exact: true });
  expect(await model.locator('option').allTextContents()).toEqual(expect.arrayContaining(['Nano Banana Pro', 'FLUX.2 Max', 'Ideogram 3.0']));
  await model.selectOption('nano-banana-pro'); await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeDisabled();
  await prompt.fill('A poster reading "SUNRISE"');
  const input = page.getByRole('group', { name: 'Reference assets', exact: true });
  await expect(input.locator('select')).toHaveCount(0);
  await dragIntoView(page, page.getByRole('button', { name: 'Library asset Reference.png', exact: true }), input);
  await expect(input.getByRole('button', { name: 'Remove reference Reference.png', exact: true })).toBeVisible();
  let finish!: () => void, body: any; const gate = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/image-prompts/enhance', async route => { body = route.request().postDataJSON(); await gate; await route.fulfill({ json: { prompt: 'A warm poster with the exact title "SUNRISE" centered above the subject from image 1.', model: body.settings.model } }); });
  const before = await positions(page);
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click(); await expect.poll(() => body?.settings.model).toBe('nano-banana-pro');
  expect(body.images).toHaveLength(1); expect(body.images[0]).toMatch(/^data:image\/jpeg;base64,/);
  await expect(page.getByRole('button', { name: 'Generate image', exact: true })).toBeDisabled(); expect(await positions(page)).toEqual(before);
  finish(); await expect(prompt).toHaveValue(/A warm poster/); expect(await positions(page)).toEqual(before);
  const enhanced = await prompt.inputValue(), error = 'The provider rejected the API key or model access. Check your .env configuration.';
  await page.unroute('**/api/image-prompts/enhance');
  await page.route('**/api/image-prompts/enhance', route => route.fulfill({ status: 502, json: { error } }));
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  const toast = page.getByRole('alert').filter({ hasText: 'Image prompt enhancement failed' });
  await expect(toast).toContainText(error); await expect(toast).toBeInViewport();
  const toolbar = (await page.locator('.menubar').boundingBox())!;
  expect((await toast.boundingBox())!.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
  await expect(page.locator('.clip-generation-editor')).not.toContainText(error);
  await expect(prompt).toHaveValue(enhanced); expect(await positions(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `test-results/enhancement-toast-${width}.png` });
  await toast.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await expect(toast).toHaveCount(0); expect(await positions(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Nano Banana Pro prompt guide ↗', exact: true })).toHaveAttribute('href', /google/);
  await page.locator('.clip-generation-editor').screenshot({ path: `test-results/image-model-enhancement-${width}.png` });
  await input.scrollIntoViewIfNeeded(); await input.screenshot({ path: `test-results/asset-drop-input-${width}.png` });
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(prompt).toHaveValue('A poster reading "SUNRISE"');
  await expect(page.getByLabel('Image count', { exact: true })).toHaveCount(0); await model.selectOption('flux-2-max');
  expect((await readProject(page)).clipGenerations[0].settings.count).toBe(1); await expect(page.getByLabel('Image count', { exact: true })).toHaveCount(0);
  await expect(page.locator('.asset-prompt-guide')).toHaveAttribute('href', /docs.bfl.ai/);
  await model.selectOption('ideogram-v3'); await expect(page.getByRole('button', { name: 'Generate image', exact: true })).toBeDisabled();
  await input.getByRole('button', { name: 'Remove reference Reference.png', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate image', exact: true })).toBeEnabled();
  await expect(page.locator('.asset-prompt-guide')).toHaveAttribute('href', /docs.ideogram.ai/);
});

test('enhancement ignores late results after changing model, draft, references, or cancelling', async ({ page }) => {
  await setup(page); await importImage(page); await create(page);
  const prompt = page.getByLabel('Generation prompt', { exact: true }), model = page.getByLabel('Generation model', { exact: true });
  await prompt.fill('Original brief'); let finish!: () => void, requests = 0, gate: Promise<void>;
  await page.route('**/api/image-prompts/enhance', async route => { const body = route.request().postDataJSON(); requests++; await gate; await route.fulfill({ json: { prompt: 'OUTDATED RESULT', model: body.settings.model } }).catch(() => undefined); });
  for (const change of ['model', 'draft', 'reference', 'cancel']) {
    gate = new Promise<void>(resolve => { finish = resolve; }); const previous = requests;
    await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click(); await expect.poll(() => requests).toBe(previous + 1);
    if (change === 'model') await model.selectOption('flux-2-max');
    if (change === 'draft') await prompt.fill('My revised brief');
    if (change === 'reference') await dragIntoView(page, page.getByRole('button', { name: 'Library asset Reference.png', exact: true }), page.getByRole('group', { name: 'Reference assets', exact: true }));
    if (change === 'cancel') await page.getByRole('button', { name: 'Cancel prompt enhancement', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeEnabled(); finish();
    await expect(prompt).toHaveValue(change === 'model' ? 'Original brief' : 'My revised brief');
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await page.unroute('**/api/image-prompts/enhance');
  await page.route('**/api/image-prompts/enhance', route => route.fulfill({ status: 502, json: { error: 'Please retry enhancement.' } }));
  const before = await positions(page); await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Please retry'); expect(await positions(page)).toEqual(before);
  await expect(prompt).toHaveValue('My revised brief');
});

test('all image models submit one image and save one generation version', async ({ page }) => {
  await setup(page); const image = await importImage(page); let submitted: any;
  await page.route('**/api/library-generations', route => { submitted = route.request().postDataJSON(); return route.fulfill({ json: { requestId: 'request_123' } }); });
  await page.route('**/api/library-generations/*/request_123', route => route.fulfill({ json: { phase: 'ready', count: 1 } }));
  await page.route('**/api/library-generations/*/request_123/content/0', route => route.fulfill({ body: image.buffer, contentType: 'image/png' }));
  for (const [index, model] of ['nano-banana-2', 'flux-2-pro', 'seedream-4.5', 'nano-banana-pro', 'flux-2-max', 'ideogram-v3'].entries()) {
    await create(page); await page.getByLabel('Generation model', { exact: true }).selectOption(model); await page.getByLabel('Generation prompt', { exact: true }).fill('A warm landscape');
    await expect(page.getByLabel('Image count', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Generate image', exact: true }).click();
    await expect.poll(async () => (await readProject(page)).clipGenerations[index].versions.length).toBe(1);
    expect(submitted.settings).toMatchObject({ model, count: 1 }); expect((await readProject(page)).clipGenerations[index].versions[0].settings).toMatchObject({ model, count: 1 });
    await expect(page.locator('.story-clip.selected .video-filmstrip img')).toBeVisible();
  }
});

test('dragging directly to image boundaries adds, replaces and clears independent references', async ({ page }) => {
  await setup(page); await importImage(page, 'First.png'); await importImage(page, 'Second.png'); await addDraft(page);
  for (const side of ['Start', 'End']) await page.getByRole('group', { name: `${side} reference type`, exact: true }).getByRole('button', { name: 'Image', exact: true }).click();
  const start = page.getByRole('group', { name: 'Start reference image', exact: true }), end = page.getByRole('group', { name: 'End reference image', exact: true });
  await dragIntoView(page, page.getByRole('button', { name: 'Library asset First.png', exact: true }), start); await expect(start).toContainText('First.png');
  await dragIntoView(page, page.getByRole('button', { name: 'Library asset Second.png', exact: true }), end); await expect(end).toContainText('Second.png');
  await dragIntoView(page, page.getByRole('button', { name: 'Library asset Second.png', exact: true }), start); await expect(start).toContainText('Second.png');
  expect((await readProject(page)).interstitials[0].imageReferences).toHaveLength(2);
  await dragIntoView(page, page.getByRole('button', { name: 'Library asset interstitial-reference.mp4', exact: true }), start);
  await expect(start.locator('.asset-input-feedback')).toContainText('Drop image assets'); await expect(start).toContainText('Second.png');
  await start.getByRole('button', { name: 'Remove reference Second.png', exact: true }).click(); await expect(end).toContainText('Second.png');
  const item = (await readProject(page)).interstitials[0]; expect(item.startReferenceType).toBe('none'); expect(item.endImageIndex).toBe(1);
  await expect(page.locator('.inspector-references select')).toHaveCount(0);
});
