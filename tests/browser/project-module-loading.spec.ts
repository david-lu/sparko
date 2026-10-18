import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { emptyAnalysis, type Project } from '../../src/features/project/types';

for (const source of ['sample', 'file'] as const) {
  test(`project ${source} open and export survive missing deployment chunks`, async ({ page }) => {
    const assetId = crypto.randomUUID(), video = await readFile('tests/fixtures/interstitial-reference.mp4');
    const project: Project = { id: 'module-test', name: 'Deployment test', updatedAt: 0,
      source: { assetId, name: 'reference.mp4' }, interstitials: [], subtitle: null, analysis: emptyAnalysis() };
    const signal = new AbortController().signal;
    const blob = await packProject(project, [{ id: assetId, name: 'reference.mp4', blob: new Blob([video], { type: 'video/mp4' }) }], signal, () => {});
    const archive = Buffer.from(await blob.arrayBuffer());
    await page.route('**/api/status', route => route.fulfill({ json: {
      requiresPassword: false, uploadMode: 'local', providers: { openai: false, gemini: false, comfy: false },
      models: { openai: 'test', gemini: 'test' },
      defaultVideo: { name: 'sample.mp4', url: '/media/sample.mp4', size: video.length },
      defaultProject: { name: 'sample.sparko', url: '/media/module-test.sparko', size: archive.length },
    } }));
    await page.route('**/media/module-test.sparko', route => route.fulfill({ body: archive, contentType: 'application/zip' }));
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Open project file/ })).toBeEnabled();
    await page.waitForLoadState('networkidle');

    // A newly published deployment can remove every old hashed JS file.
    // Project operations must use code already loaded before the tab became stale.
    const lateModules: string[] = [], errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().resourceType() !== 'script') return route.fallback();
      lateModules.push(route.request().url());
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Old deployment asset removed' });
    });
    if (source === 'sample') await page.getByRole('button', { name: /^Sample project/ }).click();
    else await page.getByLabel('Choose project file', { exact: true }).setInputFiles({ name: 'test.sparko', mimeType: 'application/zip', buffer: archive });
    await expect(page.locator('.menu-document')).toHaveText('reference.mp4');
    await expect(page.getByRole('button', { name: /^Add regular interstitial/ })).toBeEnabled();
    await page.getByText('File', { exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export project', exact: true }).click();
    const saved = await download;
    const restored = await unpackProject(new Blob([await readFile((await saved.path())!)]), signal, () => {});
    expect(restored.project.source.name).toBe('reference.mp4');
    expect(restored.assets).toHaveLength(1);
    expect(Buffer.from(await restored.assets[0].blob.arrayBuffer())).toEqual(video);
    expect(lateModules).toEqual([]);
    expect(errors).toEqual([]);
  });
}
