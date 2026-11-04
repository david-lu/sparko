import { test, expect, openVideo, readProject, dragIntoView, saveAndReopen, type Page } from './fixtures';

const video = (page: Page, name: string) => page.getByRole('button', { name: `Library asset ${name}`, exact: true });
async function createVideo(page: Page) {
  await page.getByRole('button', { name: 'Library menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Create generation', exact: true }).click();
  await page.getByRole('menu', { name: 'Create generation', exact: true }).getByRole('menuitem', { name: 'Video', exact: true }).click();
  await expect(page.getByLabel('Video prompt', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Generation model', { exact: true })).toHaveCount(0);
}

test('library and timeline share one editable video through placement, removal, undo and reopening', async ({ page }) => {
  await openVideo(page); await createVideo(page);
  await page.getByLabel('Clip name', { exact: true }).fill('Shared video');
  await page.getByLabel('Clip name', { exact: true }).press('Enter');
  await page.getByLabel('Video prompt', { exact: true }).fill('Ocean waves at dawn');
  await expect(page.locator('.story-clip')).toHaveCount(1);
  const id = (await readProject(page)).interstitials[0].id;
  await dragIntoView(page, video(page, 'Shared video'), page.locator('.story-scroll'), { x: 180, y: 220 });
  await expect(page.locator('.story-clip')).toHaveCount(2);
  expect((await readProject(page)).storyFlow.nodes.find((n: any) => n.interstitialId)?.interstitialId).toBe(id);
  await expect(page.getByLabel('Video prompt', { exact: true })).toHaveValue('Ocean waves at dawn');
  await page.getByLabel('Video prompt', { exact: true }).fill('Ocean waves in moonlight');
  await video(page, 'Shared video').click();
  await expect(page.getByLabel('Video prompt', { exact: true })).toHaveValue('Ocean waves in moonlight');
  await page.getByRole('button', { name: 'Show in timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Delete selected clips', exact: true }).click();
  await expect(page.locator('.story-clip')).toHaveCount(1);
  await expect(video(page, 'Shared video')).toBeVisible();
  expect((await readProject(page)).interstitials).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.story-clip')).toHaveCount(2);
  await saveAndReopen(page);
  await video(page, 'Shared video').click();
  await expect(page.getByLabel('Video prompt', { exact: true })).toHaveValue('Ocean waves in moonlight');
  expect((await readProject(page)).interstitials[0].id).toBe(id);
});

test('imported and generated videos select, move and report usage together', async ({ page }) => {
  await openVideo(page); await createVideo(page);
  const draft = video(page, 'Untitled video'), imported = video(page, 'interstitial-reference.mp4');
  await imported.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  const inspector = page.getByRole('region', { name: 'Selected assets', exact: true });
  await expect(inspector.locator('li')).toHaveCount(2);
  await expect(inspector.locator('input,textarea,select,button')).toHaveCount(0);
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder', exact: true });
  await dialog.getByLabel('Folder name').fill('Videos'); await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
  await draft.click(); await imported.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await dragIntoView(page, draft, page.getByRole('button', { name: 'Folder Videos', exact: true }));
  const p = await readProject(page);
  expect(p.interstitials[0].folderId).toBe(p.libraryFolders[0].id);
  expect(p.library.find((a: any) => a.name === 'interstitial-reference.mp4').folderId).toBe(p.libraryFolders[0].id);
  await page.getByRole('button', { name: 'Folder Videos', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Select unused assets', exact: true }).click();
  await expect(draft).toHaveAttribute('aria-pressed', 'true'); await expect(imported).toHaveAttribute('aria-pressed', 'false');
  await draft.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Delete asset…', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete asset', exact: true }).click();
  await expect(draft).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(draft).toBeVisible();
  expect((await readProject(page)).interstitials[0].folderId).toBe(p.libraryFolders[0].id);
});

for (const width of [1440, 390]) test(`Comfy library video retains its identity and stable controls while rendering at ${width}px`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', message => { if (message.type() === 'error' && message.text().includes('same key')) errors.push(message.text()); });
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/api/status', async route => { const response = await route.fetch(); const body = await response.json(); await route.fulfill({ json: { ...body, providers: { ...body.providers, comfy: true } } }); });
  let complete = false, submissions = 0, fal = 0;
  await page.route('**/api/library-generations', route => { fal++; return route.abort(); });
  await page.route('**/api/comfy/status*', route => route.fulfill({ json: { ready: true } }));
  await page.route('**/api/comfy/interstitials', async route => {
    submissions++;
    const body = await new Response(Uint8Array.from(route.request().postDataBuffer()!), { headers: { 'Content-Type': route.request().headers()['content-type'] } }).formData();
    expect(body.get('prompt')).toBe('Ocean waves'); expect(body.has('video')).toBe(false);
    await route.fulfill({ status: 202, json: { requestId: 'unified-video', status: 'IN_QUEUE', insertion: { start: 0, duration: 4, totalDuration: 4 } } });
  });
  await page.route('**/api/comfy/jobs/unified-video/events', route => route.fulfill({ contentType: 'text/event-stream', body: 'event: refresh\ndata: {}\n\n' }));
  await page.route('**/api/comfy/jobs/unified-video', route => route.fulfill({ json: complete ? { requestId: 'unified-video', status: 'COMPLETED', videoUrl: 'https://example.test/unified.mp4' } : { requestId: 'unified-video', status: 'IN_PROGRESS' } }));
  await page.route('https://example.test/unified.mp4', route => route.fulfill({ contentType: 'video/mp4', path: 'tests/fixtures/interstitial-reference.mp4' }));
  await openVideo(page); await createVideo(page);
  await page.getByLabel('Video prompt', { exact: true }).fill('Ocean waves');
  const shape = () => page.locator('.clip-inspector').evaluate(el => { const top = el.getBoundingClientRect().top; return ['.inspector-clip-heading', '.inspector-clip-meta', 'textarea', '.interstitial-time-fields', 'button[type=submit]', '.task-status'].flatMap(s => { const r = el.querySelector(s)?.getBoundingClientRect(); return r ? [{ y: Math.round(r.top - top), height: Math.round(r.height) }] : []; }); });
  const before = await shape(), id = (await readProject(page)).interstitials[0].id;
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect.poll(() => submissions).toBe(1); expect(fal).toBe(0); expect(await shape()).toEqual(before);
  await page.screenshot({ path: `test-results/unified-video-loading-${width}.png`, fullPage: true });
  complete = true;
  await expect.poll(async () => (await readProject(page)).interstitials[0].phase, { timeout: 30_000 }).toBe('ready');
  expect(await shape()).toEqual(before);
  await expect(video(page, 'Untitled video')).toHaveCount(1);
  await expect(page.locator('.library-media [data-library-type=video]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Add to timeline', exact: true }).click();
  await expect(page.locator('.story-clip')).toHaveCount(2);
  const p = await readProject(page);
  expect(p.interstitials).toHaveLength(1); expect(p.storyFlow.nodes.find((n: any) => n.interstitialId)?.interstitialId).toBe(id);
  expect(p.assetGenerations ?? []).toHaveLength(0);
  await expect(page.getByLabel('Video prompt', { exact: true })).toHaveValue('Ocean waves');
  if (width === 1440) {
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await expect.poll(() => submissions).toBe(2);
    await expect.poll(async () => (await readProject(page)).interstitials[0].phase, { timeout: 30_000 }).toBe('ready');
    await expect(page.locator('.library-media [data-library-type=video]')).toHaveCount(2);
    await page.locator('summary').filter({ hasText: /^Versions/ }).click();
    await expect(page.locator('.asset-versions button')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Download version', exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
