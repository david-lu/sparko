import { expect, test, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';

const activeProject = (page: Page) => page.evaluate(async () => {
  const { readActiveProject } = await import('/src/features/project/database.ts' as string); return readActiveProject();
});
async function openVideo(page: Page) {
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.menu-document')).toHaveText('interstitial-reference.mp4');
  await expect(page.getByRole('button', { name: /^Add regular interstitial/ })).toBeEnabled();
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Video timeline', exact: true }).getAttribute('max'))).toBe(4);
}
test.beforeEach(async ({ page }) => {
  await page.route('**/api/status', async route => { const response = await route.fetch(); const body = await response.json(); await route.fulfill({ json: { ...body, providers: { openai: true, gemini: true, comfy: true } } }); });
  await page.route('**/media/sample.mp4', route => route.fulfill({ path: 'tests/fixtures/interstitial-reference.mp4', contentType: 'video/mp4' }));
  await page.goto('/');
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.getByRole('button', { name: /^Add regular interstitial/ })).toBeEnabled();
});

test('exports a complete project and restores assets, drafts, subtitles and analysis in a fresh browser', async ({ page, browser }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openVideo(page);
  const videoBytes = await readFile('tests/fixtures/interstitial-reference.mp4');
  await page.route('https://example.test/project-test.mp4', route => route.fulfill({ contentType: 'video/mp4', body: videoBytes }));
  await page.route('**/api/comfy/interstitials', route => route.fulfill({ status: 202, json: { requestId: 'project-test-job', status: 'IN_QUEUE' } }));
  await page.route('**/api/comfy/jobs/project-test-job', route => route.fulfill({ json: { requestId: 'project-test-job', status: 'COMPLETED', videoUrl: 'https://example.test/project-test.mp4', insertion: { start: 1, duration: 2, totalDuration: 4 } } }));
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('2');
  await page.getByRole('button', { name: /^Add regular interstitial/ }).click();
  await page.getByLabel('Interstitial prompt').fill('The embedded scene');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.locator('.rendered-interstitial')).toHaveCount(1, { timeout: 60_000 });
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('1');
  await page.getByRole('button', { name: /^Add regular interstitial/ }).click();
  await page.getByLabel('Interstitial prompt').fill('Unfinished draft');
  await page.getByRole('textbox', { name: 'Interstitial name', exact: true }).fill('Unfinished draft');
  await page.getByRole('textbox', { name: 'Interstitial name', exact: true }).press('Enter');
  await page.getByLabel('start_range').fill('3');
  await page.getByLabel('end_range').fill('1.5');
  await page.getByLabel('Choose subtitle file').setInputFiles({ name: 'dialogue.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nEmbedded dialogue\n') });
  await expect.poll(async () => (await activeProject(page)).subtitle?.assetId).toBeTruthy();
  // Existing project analysis must survive even while the Describe panel is unavailable.
  await page.evaluate(async () => {
    const { readActiveProject, writeProject } = await import('/src/features/project/database.ts' as string);
    const project = await readActiveProject();
    const snapshot = { ...project, analysis: { ...project.analysis, provider: 'gemini', instructions: 'Saved focus',
      result: { caption: 'Saved caption', description: 'Saved description', provider: 'gemini', model: 'test-model', start: 0, end: 4, basis: 'Video' } } };
    await writeProject(snapshot);
    await writeProject({ ...snapshot, id: `project:${crypto.randomUUID()}`, saved: true });
  });
  await page.reload();
  await page.getByRole('region', { name: 'Recent projects' }).getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.rendered-interstitial')).toHaveCount(1, { timeout: 60_000 });
  await page.getByText('File', { exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export project', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('interstitial-reference.sparko');
  const path = (await download.path())!;
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 1440, height: 1000 } });
  const restored = await context.newPage();
  await restored.route('**/media/sample.mp4', route => route.fulfill({ path: 'tests/fixtures/interstitial-reference.mp4', contentType: 'video/mp4' }));
  let remoteReads = 0;
  await restored.route('https://example.test/**', route => { remoteReads++; return route.abort(); });
  await restored.goto('/');
  await expect(restored.getByRole('heading', { name: 'Make videos pop.' })).toBeVisible();
  await restored.getByLabel('Choose project file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/zip', buffer: await readFile(path) });
  await expect(restored.locator('.menu-document')).toHaveText('interstitial-reference.mp4', { timeout: 30_000 });
  await expect(restored.locator('.rendered-interstitial')).toHaveCount(1, { timeout: 60_000 });
  await restored.getByRole('button', { name: 'Select Unfinished draft', exact: true }).click();
  await expect(restored.getByLabel('Interstitial prompt')).toHaveValue('Unfinished draft');
  await expect(restored.getByLabel('start_range')).toHaveValue('3');
  await expect(restored.getByLabel('end_range')).toHaveValue('1.5');
  const project = await activeProject(restored);
  expect(project.id).not.toBe((await activeProject(page)).id);
  const stored = await restored.evaluate(async (project: any) => {
    const { readAsset } = await import('/src/features/project/database.ts' as string);
    const result = project.interstitials.find((item: any) => item.result).result;
    return { source: [...new Uint8Array(await (await readAsset(project.source.assetId)).blob.arrayBuffer())],
      originalAssetId: project.source.originalAssetId,
      scene: [...new Uint8Array(await (await readAsset(result.assetId)).blob.arrayBuffer())],
      subtitle: await (await readAsset(project.subtitle.assetId)).blob.text() };
  }, project);
  const sourceBytes = await page.evaluate(async () => {
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    return [...new Uint8Array(await (await readAsset((await readActiveProject()).source.assetId)).blob.arrayBuffer())];
  });
  expect(stored.source).toEqual(sourceBytes);
  expect(Buffer.from(stored.source)).toEqual(videoBytes);
  expect(stored.originalAssetId).toBeUndefined(); expect(Buffer.from(stored.scene)).toEqual(videoBytes);
  expect(stored.subtitle).toContain('Embedded dialogue');
  expect(project.analysis).toMatchObject({ provider: 'gemini', instructions: 'Saved focus', result: { description: 'Saved description' } });
  await restored.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async ({ suggestedName }: { suggestedName: string }) =>
      (await navigator.storage.getDirectory()).getFileHandle(suggestedName, { create: true }) });
  });
  await restored.getByText('File', { exact: true }).click();
  await restored.getByRole('menuitem', { name: 'Save project' }).click();
  await expect.poll(() => restored.evaluate(async () => {
    const { listRecentFiles } = await import('/src/features/project/database.ts' as string); return (await listRecentFiles()).length;
  })).toBe(1);
  await restored.route('http://127.0.0.1:3000/media/**', route => route.abort());
  await restored.reload();
  await restored.getByRole('region', { name: 'Recent projects' }).getByRole('button', { name: 'Open' }).click();
  await expect(restored.locator('.rendered-interstitial')).toHaveCount(1, { timeout: 60_000 });
  expect(remoteReads).toBe(0);
  expect((await activeProject(restored)).subtitle?.assetId).toBeTruthy();
  await restored.screenshot({ path: 'test-results/project-imported.png' });
  await context.close(); expect(errors).toEqual([]);
});

test('chooses a video, then opens and deletes an explicitly saved project', async ({ page }) => {
  await openVideo(page);
  const original = await activeProject(page);
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async ({ suggestedName }: { suggestedName: string }) =>
      (await navigator.storage.getDirectory()).getFileHandle(suggestedName, { create: true }) });
  });
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('1');
  await page.getByRole('button', { name: /^Add regular interstitial/ }).click();
  await page.getByLabel('Interstitial prompt').fill('Saved draft');
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save project' }).click();
  await expect.poll(() => page.evaluate(async () => (await (await navigator.storage.getDirectory()).getFileHandle('interstitial-reference.sparko')).getFile().then(file => file.size))).toBeGreaterThan(1000);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Make videos pop.' })).toBeVisible();
  const library = page.getByRole('region', { name: 'Recent projects' });
  await expect(library.getByText('interstitial-reference.sparko')).toBeVisible();
  await library.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.menu-document')).toHaveText('interstitial-reference.sparko');
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Video timeline', exact: true }).getAttribute('max'))).toBe(4);
  expect((await activeProject(page)).id).toBe(original.id);
  await page.getByRole('button', { name: 'Select Untitled', exact: true }).click();
  await expect(page.getByLabel('Interstitial prompt')).toHaveValue('Saved draft');
  await page.getByLabel('Interstitial prompt').fill('Updated draft');
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save project' }).click();
  await expect.poll(() => page.evaluate(async () => {
    try {
      const { unpackProject } = await import('/src/features/project/archive.ts' as string);
      const file = await (await (await navigator.storage.getDirectory()).getFileHandle('interstitial-reference.sparko')).getFile();
      return (await unpackProject(file, new AbortController().signal, () => undefined)).project.interstitials[0].prompt;
    } catch (error) {
      if ((error as DOMException).name === 'NotReadableError') return '';
      throw error;
    }
  })).toBe('Updated draft');
  await page.getByLabel('Choose project file').setInputFiles({ name: 'broken.sparko', mimeType: 'application/zip', buffer: Buffer.from('not a project') });
  await expect(page.locator('.error-banner')).toBeVisible();
  expect((await activeProject(page)).id).toBe(original.id);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'assets') throw new DOMException('Test quota', 'QuotaExceededError');
      return originalPut.apply(this, args);
    };
  });
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles({ name: 'another.mp4', mimeType: 'video/mp4', buffer: await readFile('tests/fixtures/interstitial-reference.mp4') });
  await expect(page.locator('.error-banner')).toContainText('Browser storage is full');
  expect((await activeProject(page)).id).toBe(original.id);
  await expect(page.locator('.menu-document')).toHaveText('interstitial-reference.sparko');
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Close project' }).click();
  const recent = page.getByRole('region', { name: 'Recent projects' });
  await recent.getByRole('button', { name: 'Delete file interstitial-reference.sparko' }).click();
  await recent.getByRole('button', { name: 'Delete file', exact: true }).click();
  await expect(recent.getByText('Bring a video and it will show up here next time.')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    try { await (await navigator.storage.getDirectory()).getFileHandle('interstitial-reference.sparko'); return false; }
    catch { return true; }
  })).toBe(true);
});

test('rolls back every asset and the active project if a multi-asset import cannot commit', async ({ page }) => {
  const before = await activeProject(page);
  const rollback = await page.evaluate(async () => {
    const { readActiveProject, readAsset, readProject, writeProject } = await import('/src/features/project/database.ts' as string);
    const original = await readActiveProject();
    const first = crypto.randomUUID(), second = crypto.randomUUID(), id = `project:${crypto.randomUUID()}`;
    const originalPut = IDBObjectStore.prototype.put;
    let writes = 0, failure = '';
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'assets' && ++writes === 2) throw new DOMException('Test full disk', 'QuotaExceededError');
      return originalPut.apply(this, args);
    };
    try {
      await writeProject({ ...original, id }, [{ id: first, name: 'first', blob: new Blob(['one']) }, { id: second, name: 'second', blob: new Blob(['two']) }], true);
    } catch (error) { failure = (error as Error).name; }
    finally { IDBObjectStore.prototype.put = originalPut; }
    return { failure, active: (await readActiveProject()).id, first: !!await readAsset(first), second: !!await readAsset(second), project: !!await readProject(id) };
  });
  expect(rollback).toEqual({ failure: 'QuotaExceededError', active: before.id, first: false, second: false, project: false });
});

test('cancelling a storage transaction leaves no imported assets or active-project change', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { readActiveProject, readAsset, readProject, writeProject } = await import('/src/features/project/database.ts' as string);
    const original = await readActiveProject(), id = crypto.randomUUID(), assetId = crypto.randomUUID();
    const operation = new AbortController(), originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const request = originalPut.apply(this, args);
      if (this.name === 'assets') operation.abort();
      return request;
    };
    let error = '';
    try { await writeProject({ ...original, id }, [{ id: assetId, name: 'cancelled', blob: new Blob(['media']) }], true, operation.signal); }
    catch (cause) { error = (cause as Error).name; }
    finally { IDBObjectStore.prototype.put = originalPut; }
    return { error, asset: !!await readAsset(assetId), project: !!await readProject(id), unchanged: (await readActiveProject()).id === original.id };
  });
  expect(result).toEqual({ error: 'AbortError', asset: false, project: false, unchanged: true });
});
