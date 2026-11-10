import { test, expect, openVideo, addDraft, addBridge, fitAll, readProject, type Page } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/status', async route => {
    const status = await (await route.fetch()).json();
    await route.fulfill({ json: { ...status, providers: { ...status.providers, openai: true, fal: true, comfy: true, gemini: true } } });
  });
  await openVideo(page);
});

async function deselect(page: Page) {
  await page.locator('.story-scroll').scrollIntoViewIfNeeded();
  await fitAll(page);
  await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toHaveCount(0);
}
const select = (page: Page, id: string) => page.locator(`[data-node-id="${id}"] .story-clip-title`).click();
const layout = (page: Page) => page.locator('.interstitial-editor, .clip-generation-editor').evaluate(root => {
  const top = root.getBoundingClientRect().top;
  return ['.prompt-field-heading', 'textarea', '.enhanced-prompt-field', 'button[type=submit]'].map(selector => {
    const box = root.querySelector(selector)!.getBoundingClientRect(); return { top: box.top - top, height: box.height };
  });
});

for (const kind of ['video', 'image'] as const) for (const width of [1440, 390]) {
  test(`${kind} enhancements keep independent state through deselection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const prompt = page.getByLabel(kind === 'video' ? 'Video prompt' : 'Generation prompt', { exact: true });
    const ids: string[] = [];
    for (const draft of ['First clip', 'Second clip']) {
      if (kind === 'video') await addDraft(page);
      else await page.getByRole('button', { name: 'Add image', exact: true }).press('Enter');
      await prompt.fill(draft);
      ids.push((await page.locator('.story-clip.selected').getAttribute('data-node-id'))!);
    }
    await deselect(page);
    const releases = new Map<string, () => void>();
    let requests = 0;
    await page.route(kind === 'video' ? '**/api/interstitials/enhance-prompt' : '**/api/image-prompts/enhance', async route => {
      const body = route.request().postDataJSON(), draft = body.settings?.prompt ?? body.prompt;
      requests++;
      await new Promise<void>(resolve => releases.set(draft, resolve));
      await route.fulfill({ json: { prompt: `${draft} enhanced`, model: body.settings?.model ?? 'test' } });
    });
    await select(page, ids[0]); const firstLayout = await layout(page);
    await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
    await expect.poll(() => requests).toBe(1);
    expect(await layout(page)).toEqual(firstLayout);
    await select(page, ids[1]); const secondLayout = await layout(page);
    await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
    await expect.poll(() => requests).toBe(2);
    await select(page, ids[0]);
    await expect(page.getByRole('button', { name: 'Enhancing…', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Cancel prompt enhancement' })).toBeVisible();
    expect(await layout(page)).toEqual(firstLayout);
    await deselect(page);
    releases.get('First clip')!();
    const saved = async () => {
      const project = await readProject(page);
      return kind === 'video' ? project.interstitials : project.clipGenerations.map((g: any) => g.settings);
    };
    await expect.poll(async () => (await saved()).find((item: any) => item.prompt === 'First clip')?.enhancedPrompt).toBe('First clip enhanced');
    await select(page, ids[0]);
    await expect(page.getByLabel('Enhanced prompt', { exact: true })).toHaveValue('First clip enhanced');
    await expect(prompt).toHaveValue('First clip'); expect(await layout(page)).toEqual(firstLayout);
    await select(page, ids[1]);
    await expect(page.getByRole('button', { name: 'Enhancing…', exact: true })).toBeDisabled();
    expect(await layout(page)).toEqual(secondLayout);
    releases.get('Second clip')!();
    await expect(page.getByLabel('Enhanced prompt', { exact: true })).toHaveValue('Second clip enhanced');
    await expect(prompt).toHaveValue('Second clip'); expect(await layout(page)).toEqual(secondLayout);
    expect(requests).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });

  if (width === 1440) test(`${kind} enhancement can be cancelled after returning to the clip`, async ({ page }) => {
    if (kind === 'video') await addDraft(page); else await page.getByRole('button', { name: 'Add image', exact: true }).press('Enter');
    const id = (await page.locator('.story-clip.selected').getAttribute('data-node-id'))!;
    const prompt = page.getByLabel(kind === 'video' ? 'Video prompt' : 'Generation prompt', { exact: true });
    await prompt.fill('Keep this draft');
    let release!: () => void, requests = 0;
    await page.route(kind === 'video' ? '**/api/interstitials/enhance-prompt' : '**/api/image-prompts/enhance', async route => {
      const body = route.request().postDataJSON(); requests++;
      await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ json: { prompt: 'Cancelled result', model: body.settings?.model ?? 'test' } }).catch(() => {});
    });
    await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
    await expect.poll(() => requests).toBe(1);
    await deselect(page); await select(page, id);
    await page.getByRole('button', { name: 'Cancel prompt enhancement' }).click(); release();
    await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeEnabled();
    await expect(prompt).toHaveValue('Keep this draft');
    await expect(page.getByLabel('Enhanced prompt', { exact: true })).toHaveValue('');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('reference analysis keeps its progress after the clip is deselected', async ({ page }) => {
  await addBridge(page);
  const id = (await page.locator('.story-clip.selected').getAttribute('data-node-id'))!;
  await page.getByLabel('Video prompt', { exact: true }).fill('She waves.');
  await page.getByRole('checkbox', { name: 'Analyze reference videos with AI' }).check();
  let release!: () => void, analyses = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/analyze/gemini', async route => {
    analyses++;
    await gate;
    await route.fulfill({ json: { description: 'She waits; music continues.', caption: 'Waiting', start: 0, end: 1.625, provider: 'gemini', model: 'test', basis: 'Video' } });
  });
  await page.route('**/api/interstitials/enhance-prompt', route => route.fulfill({ json: { prompt: 'She waves while the music continues.', model: 'test' } }));
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect.poll(() => analyses, { timeout: 60_000 }).toBe(1);
  await deselect(page); await select(page, id);
  await expect(page.getByRole('button', { name: 'Analyzing…', exact: true })).toBeDisabled();
  release();
  await expect(page.getByLabel('Enhanced prompt', { exact: true })).toHaveValue('She waves while the music continues.');
  expect(analyses).toBe(2);
});
