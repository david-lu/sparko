import { expect, test } from './fixtures';

test('starts on the chooser and creates a project from a video without loading the sample', async ({ page }) => {
  let sampleRequests = 0;
  await page.route('**/media/episode_mock.mp4', route => { sampleRequests++; return route.fallback(); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose a project' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('Projects you open or save will appear here');
  await expect(page.getByRole('region', { name: 'Sample projects' }).getByRole('button', { name: /Sample video/ })).toBeVisible();
  expect(sampleRequests).toBe(0);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Create project from video/ }).click();
  await (await chooser).setFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.menu-document')).toHaveText('interstitial-reference.mp4');
  expect(sampleRequests).toBe(0);
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Choose project' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a project' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to editor' }).click();
  await expect(page.locator('.menu-document')).toHaveText('interstitial-reference.mp4');
});

test('opens the sample only after selection', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose a project' })).toBeVisible();
  await page.getByRole('button', { name: /Sample video/ }).click();
  await expect(page.locator('.menu-document')).toHaveText('episode_mock.mp4');
  await expect(page.getByRole('button', { name: /^Add interstitial/ })).toBeEnabled();
});

test('does not list every old call response autosave as a saved project', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose a project' })).toBeVisible();
  await page.evaluate(async () => {
    const { writeProject } = await import('/src/features/project/database.ts' as string);
    const { emptyAnalysis } = await import('/src/features/project/types.ts' as string);
    for (let index = 0; index < 4; index++) await writeProject({
      id: `project:legacy-${index}`, name: 'Test call response', updatedAt: Date.now() + index,
      source: { name: 'legacy.mp4', url: '/media/episode_mock.mp4' }, interstitials: [], subtitle: null, analysis: emptyAnalysis(),
    }, [], index === 3);
  });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Recent projects' }).getByText('Test call response')).toHaveCount(1);
});
