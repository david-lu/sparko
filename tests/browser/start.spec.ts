import { expect, test } from './fixtures';

test('starts with an empty project and keeps the player above its timeline', async ({ page }) => {
  let sampleRequests = 0;
  await page.route('**/media/sample.mp4', route => { sampleRequests++; return route.fallback(); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make videos pop.' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('Create a project, then add your clips.');
  await expect(page.getByRole('button', { name: /Sample video/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Sample projects' }).getByRole('button', { name: /Sample project/ })).toBeVisible();
  expect(sampleRequests).toBe(0);
  await page.getByRole('button', { name: /^New project/ }).click();
  await expect(page.locator('.menu-document')).toHaveText('Untitled project');
  await expect(page.locator('.story-clip')).toHaveCount(0);await expect(page.getByText('Drop video files here',{exact:true})).toBeVisible();
  expect((await page.locator('.video-stage').boundingBox())!.y).toBeLessThan((await page.locator('.story-canvas').boundingBox())!.y);
  expect(sampleRequests).toBe(0);
  await page.getByText('File', { exact: true }).click();
  await expect(page.getByRole('menu', { name: 'File' }).getByRole('menuitem')).toHaveText([
    'Close project', 'Save project', 'Save as new file', 'Export project',
  ]);
  await page.getByRole('menuitem', { name: 'Close project' }).click();
  await expect(page.getByRole('heading', { name: 'Make videos pop.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to editor' })).toHaveCount(0);
  await expect(page.locator('.video-stage video')).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    return readActiveProject();
  })).toBeUndefined();
  await page.getByRole('button', { name: /^New project/ }).click();
  await expect(page.locator('.menu-document')).toHaveText('Untitled project');await expect(page.locator('.story-clip')).toHaveCount(0);
});

test('shows the sample project without a sample video action', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make videos pop.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Sample video/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Sample projects' }).getByRole('button', { name: /Sample project/ })).toBeVisible();
});

test('opens the bundled sample project with its saved interstitials', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByRole('region', { name: 'Sample projects' }).getByRole('button', { name: /Sample project/ }).click();
  await expect(page.locator('.menu-document')).toBeVisible({ timeout: 180_000 });
  const project = await page.evaluate(async () => {
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    return readActiveProject();
  });
  await expect(page.locator('.menu-document')).toHaveText(project.name);
  expect(project.source.name).toMatch(/\.mp4$/);
  expect(project.interstitials.filter((item: { phase: string }) => item.phase === 'ready').length).toBeGreaterThan(0);
});

test('asks before closing a project with unsaved changes', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.story-clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Add interstitial', exact:true }).dragTo(page.locator('.story-scroll'));
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Close project' }).click();
  const prompt = page.getByRole('dialog', { name: 'Save changes before closing?' });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.menu-document')).toHaveText('interstitial-reference.mp4');
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Close project' }).click();
  await prompt.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('heading', { name: 'Make videos pop.' })).toBeVisible();
});

test('saves an edited project to disk before closing', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.story-clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Add interstitial', exact:true }).dragTo(page.locator('.story-scroll'));
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async ({ suggestedName }: { suggestedName: string }) =>
      (await navigator.storage.getDirectory()).getFileHandle(suggestedName, { create: true }) });
  });
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Close project' }).click();
  await page.getByRole('dialog', { name: 'Save changes before closing?' }).getByRole('button', { name: 'Save and close' }).click();
  await expect(page.getByRole('heading', { name: 'Make videos pop.' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent projects' }).getByText('interstitial-reference.sparko')).toBeVisible();
});

test('does not list every old call response autosave as a saved project', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make videos pop.' })).toBeVisible();
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
