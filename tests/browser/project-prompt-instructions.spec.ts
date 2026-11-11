import { addDraft, expect, fitAll, openVideo, readProject, saveAndReopen, test, type Page } from './fixtures';

const section = (page: Page) => page.getByRole('region', { name: 'Project enhance instructions', exact: true });
const field = (page: Page) => section(page).getByLabel('Enhance instructions', { exact: true });
async function setup(page: Page) {
  await page.route('**/api/status', async route => { const response = await route.fetch(), status = await response.json(); await route.fulfill({ json: { ...status, providers: { ...status.providers, fal: true, openai: true } } }); });
  await openVideo(page);
}

// 320px is the stricter narrow check; no style rule between 320 and 390px applies here.
for (const width of [1440, 320]) test(`project enhance instructions fit the Project inspector at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width <= 390 ? 667 : 1000 }); await setup(page);
  await field(page).scrollIntoViewIfNeeded();
  await expect(field(page)).toBeVisible(); await expect(field(page)).toHaveValue('');
  await field(page).fill('Keep a warm 16mm look.\nAll dialogue is in Spanish.\n'.repeat(4));
  const [box, outer] = await Promise.all([field(page).boundingBox(), section(page).boundingBox()]);
  expect(box!.x).toBeGreaterThanOrEqual(outer!.x); expect(box!.x + box!.width).toBeLessThanOrEqual(outer!.x + outer!.width + 0.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await section(page).screenshot({ path: `test-results/project-enhance-instructions-${width}.png` });
});

test('project enhance instructions apply to video and image enhancement, undo as one edit and persist', async ({ page }) => {
  await setup(page);
  await field(page).pressSequentially('Warm', { delay: 20 });
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(field(page)).toHaveValue('');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(field(page)).toHaveValue('Warm');
  await field(page).fill('  Keep a warm 16mm look.  ');

  const videos: { prompt: string; projectInstructions?: string }[] = [];
  await page.route('**/api/interstitials/enhance-prompt', route => { videos.push(route.request().postDataJSON()); return route.fulfill({ json: { prompt: `Enhanced ${videos.length}`, model: 'test-model' } }); });
  await addDraft(page, 'Instructions');
  await page.getByLabel('Video prompt', { exact: true }).fill('She waves.');
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect(page.getByLabel('Enhanced prompt', { exact: true })).toHaveValue('Enhanced 1');
  expect(videos.at(-1)).toMatchObject({ prompt: 'She waves.', projectInstructions: 'Keep a warm 16mm look.' });

  const images: { projectInstructions?: string; settings: { model: string } }[] = [];
  await page.route('**/api/image-prompts/enhance', route => { images.push(route.request().postDataJSON()); return route.fulfill({ json: { prompt: 'A warm poster.', model: images.at(-1)!.settings.model } }); });
  await page.getByRole('button', { name: 'Add image', exact: true }).press('Enter');
  await page.getByLabel('Generation prompt', { exact: true }).fill('A poster');
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect(page.getByLabel('Enhanced prompt', { exact: true })).toHaveValue('A warm poster.');
  expect(images.at(-1)?.projectInstructions).toBe('Keep a warm 16mm look.');

  await fitAll(page); await field(page).fill('   ');
  await page.locator('.story-clip', { hasText: 'Instructions' }).locator('.story-clip-title').click();
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect(page.getByLabel('Enhanced prompt', { exact: true })).toHaveValue('Enhanced 2');
  expect(videos.at(-1)).not.toHaveProperty('projectInstructions');

  await fitAll(page); await field(page).fill('Keep a warm 16mm look.\nAll dialogue is in Spanish.');
  await saveAndReopen(page); await fitAll(page);
  await expect(field(page)).toHaveValue('Keep a warm 16mm look.\nAll dialogue is in Spanish.');
  expect((await readProject(page)).promptInstructions).toBe('Keep a warm 16mm look.\nAll dialogue is in Spanish.');
});
