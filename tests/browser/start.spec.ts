import { expect, test } from './fixtures';

test('starts on the chooser and creates a project from a video without loading the sample', async ({ page }) => {
  let sampleRequests = 0;
  await page.route('**/media/sample.mp4', route => { sampleRequests++; return route.fallback(); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose a project' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('Projects you open or save will appear here');
  await expect(page.getByRole('region', { name: 'Sample projects' }).getByRole('button', { name: /Sample video/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sample projects' }).getByRole('button', { name: /Sample project/ })).toBeVisible();
  expect(sampleRequests).toBe(0);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Create project from video/ }).click();
  await (await chooser).setFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.menu-document')).toHaveText('interstitial-reference.mp4');
  expect(sampleRequests).toBe(0);
  await page.getByText('File', { exact: true }).click();
  await expect(page.getByRole('menu', { name: 'File' }).getByRole('menuitem')).toHaveText([
    'Close project', 'Save project', 'Save as new file', 'Export project',
  ]);
  await page.getByRole('menuitem', { name: 'Close project' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a project' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to editor' })).toHaveCount(0);
  await expect(page.locator('.video-stage video')).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    return readActiveProject();
  })).toBeUndefined();
  const reopen = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Create project from video/ }).click();
  await (await reopen).setFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.menu-document')).toHaveText('interstitial-reference.mp4');
});

test('opens the sample only after selection', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose a project' })).toBeVisible();
  await page.getByRole('button', { name: /Sample video/ }).click();
  await expect(page.locator('.menu-document')).toHaveText('sample.mp4');
  await expect(page.getByRole('button', { name: /^Add regular interstitial/ })).toBeEnabled();
});

test('opens the bundled sample project with its saved interstitials', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByRole('region', { name: 'Sample projects' }).getByRole('button', { name: /Sample project/ }).click();
  await expect(page.locator('.menu-document')).toHaveText('episode_mock.mp4', { timeout: 180_000 });
  const project = await page.evaluate(async () => {
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    return readActiveProject();
  });
  expect(project.name).toBe('Sample project');
  expect(project.source.name).toBe('episode_mock.mp4');
  expect(project.interstitials.filter((item: { phase: string }) => item.phase === 'ready')).toHaveLength(2);
});

test('loads sample media instead of a cached episode and preserves the old project', async ({ page }) => {
  let sampleRequests = 0;
  await page.route('**/media/sample.mp4', route => {
    sampleRequests++;
    return route.fulfill({ path: 'tests/fixtures/interstitial-reference.mp4', contentType: 'video/mp4' });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const { writeProject } = await import('/src/features/project/database.ts' as string);
    const { emptyAnalysis } = await import('/src/features/project/types.ts' as string);
    await writeProject({ id: 'default:episode_mock.mp4', name: 'Legacy sample', updatedAt: Date.now(),
      source: { name: 'sample.mp4', assetId: 'old-episode-asset', url: '/media/episode_mock.mp4' },
      interstitials: [], subtitle: null, analysis: { ...emptyAnalysis(), instructions: 'Keep old notes' } },
    [{ id: 'old-episode-asset', name: 'episode_mock.mp4', blob: new Blob(['old episode'], { type: 'video/mp4' }) }], true);
  });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Recent projects' }).getByText('Legacy sample')).toBeVisible();
  await page.getByRole('button', { name: /Sample video/ }).click();
  await expect(page.getByRole('button', { name: /^Add regular interstitial/ })).toBeEnabled();
  expect(sampleRequests).toBe(1);
  const source = await page.evaluate(async () => {
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    const project = await readActiveProject();
    return { id: project.id, name: project.source.name, assetId: project.source.assetId,
      size: (await readAsset(project.source.assetId)).blob.size };
  });
  expect(source).toMatchObject({ id: 'default:sample.mp4', name: 'sample.mp4' });
  expect(source.assetId).not.toBe('old-episode-asset');
  expect(source.size).toBeGreaterThan(1000);
});

test('asks before closing a project with unsaved changes', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.getByRole('button', { name: /^Add regular interstitial/ })).toBeEnabled();
  await page.getByRole('button', { name: /^Add regular interstitial/ }).click();
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Close project' }).click();
  const prompt = page.getByRole('dialog', { name: 'Save changes before closing?' });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.menu-document')).toHaveText('interstitial-reference.mp4');
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Close project' }).click();
  await prompt.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a project' })).toBeVisible();
});

test('saves an edited project to disk before closing', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.getByRole('button', { name: /^Add regular interstitial/ })).toBeEnabled();
  await page.getByRole('button', { name: /^Add regular interstitial/ }).click();
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async ({ suggestedName }: { suggestedName: string }) =>
      (await navigator.storage.getDirectory()).getFileHandle(suggestedName, { create: true }) });
  });
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Close project' }).click();
  await page.getByRole('dialog', { name: 'Save changes before closing?' }).getByRole('button', { name: 'Save and close' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a project' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent projects' }).getByText('interstitial-reference.sparko')).toBeVisible();
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
