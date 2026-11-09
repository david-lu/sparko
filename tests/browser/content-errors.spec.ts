import { setVideoReference, addBridge, addDraft, expect, fitAll, openVideo, readProject, test, type Page } from './fixtures';

async function mockProviders(page: Page) {
  let submissions = 0;
  await page.route('**/api/status', async route => {
    const response = await route.fetch(), body = await response.json();
    await route.fulfill({ json: { ...body, providers: { ...body.providers, comfy: true, fal: true } } });
  });
  for (const endpoint of ['**/api/comfy/interstitials', '**/api/library-generations']) {
    await page.route(endpoint, route => { submissions++; return route.fulfill({ status: 400, json: { error: 'This test must not generate media.' } }); });
  }
  return () => submissions;
}
const referenceType = (page: Page, side: 'Start' | 'End', kind: 'None' | 'Video') => setVideoReference(page, side === 'Start' ? 'start' : 'end', kind === 'Video');
const positions = (page: Page) => page.locator('.clip-inspector').evaluate(el => {
  const root = el.getBoundingClientRect();
  return ['.generation-timeline-summary', '.inspector-prompt', '.task-status'].map(selector => {
    const box = el.querySelector(selector)!.getBoundingClientRect(); return { x: box.x - root.x, y: box.y - root.y, width: box.width, height: box.height };
  });
});

for (const width of [1440, 390]) test(`missing Start/End content has clickable errors without moving controls at ${width}px`, async ({ page }) => {
  const submissions = await mockProviders(page), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page); await addDraft(page, 'Reference test');
  await referenceType(page, 'Start', 'Video'); await referenceType(page, 'End', 'Video');
  const status = page.locator('.task-status');
  await expect(status).toContainText('Connect an incoming clip');
  const before = await positions(page);
  await fitAll(page);
  const graph = (await readProject(page)).storyFlow;
  const timelineError = page.getByRole('button', { name: 'Reference test errors', exact: true });
  await timelineError.click(); const timelineDetails = page.getByRole('dialog', { name: 'Reference test errors', exact: true });
  await expect(timelineDetails).toContainText('Start reference'); await expect(timelineDetails).toContainText('End reference');
  await page.screenshot({ path: `test-results/content-errors-${width}.png`, fullPage: true });
  await page.keyboard.press('Escape'); expect((await readProject(page)).storyFlow).toEqual(graph);
  await page.locator('.story-clip.type-simple .story-clip-title').click();
  await referenceType(page, 'Start', 'None'); await referenceType(page, 'End', 'None');
  await expect(status).not.toContainText('Connect an incoming clip'); await expect(timelineError).toHaveCount(0);
  expect(await positions(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(errors).toEqual([]); expect(submissions()).toBe(0);
});

test('missing video files surface on the clip and reference, block generation, and clear after restoration', async ({ page }) => {
  const submissions = await mockProviders(page); await openVideo(page); await addBridge(page); await page.getByLabel('Clip name', { exact: true }).fill('Missing media scene');
  await referenceType(page, 'Start', 'Video'); await referenceType(page, 'End', 'None');
  await page.getByLabel('Video prompt', { exact: true }).fill('A local test that must never submit.');
  const generate = page.getByRole('button', { name: 'Generate', exact: true }); await expect(generate).toBeEnabled();
  const before = await positions(page), id = (await readProject(page)).source.assetId;
  await page.evaluate(async id => {
    const { readAsset } = await import('/src/features/project/database.ts' as string);
    const { assets } = await import('/src/features/project/assets.ts' as string);
    (window as any).__restoreMedia = await readAsset(id);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('sparko-projects', 3);
      request.onsuccess = () => { const db = request.result, tx = db.transaction('assets', 'readwrite'); tx.objectStore('assets').delete(id); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
    });
    await assets.open(id).catch(() => {});
  }, id);
  const error = page.getByRole('button', { name: 'Missing media scene errors', exact: true }); await expect(error).toBeVisible();
  await expect(generate).toBeDisabled(); expect(await positions(page)).toEqual(before);
  await error.click(); await expect(page.getByRole('dialog', { name: 'Missing media scene errors', exact: true })).toContainText('saved media file is missing');
  await page.keyboard.press('Escape'); await fitAll(page);
  await page.locator('.story-clip.type-source').first().getByRole('button', { name: /errors$/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Source video unavailable'); await page.keyboard.press('Escape');
  await expect(page.getByRole('img', { name: 'Video unavailable: missing media', exact: true }).first()).toBeVisible();
  await page.evaluate(async () => {
    const { writeAsset } = await import('/src/features/project/database.ts' as string);
    const { assets } = await import('/src/features/project/assets.ts' as string);
    await writeAsset((window as any).__restoreMedia); await assets.open((window as any).__restoreMedia.id); delete (window as any).__restoreMedia;
  });
  await page.locator('.story-clip.type-simple .story-clip-title').click(); await expect(error).toHaveCount(0); await expect(generate).toBeEnabled();
  expect(submissions()).toBe(0);
});
