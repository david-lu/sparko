import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { packProject } from '../../src/features/project/archive';
import { emptyAnalysis } from '../../src/features/project/types';

const exampleUrl = 'https://example.public.blob.vercel-storage.com/defaults/example.sparko';
let archive: Buffer;
let video: Buffer;
test.beforeAll(async () => {
  const sourceId = crypto.randomUUID(), sceneId = crypto.randomUUID();
  video = await readFile('tests/fixtures/interstitial-reference.mp4');
  const blob = new Blob([new Uint8Array(video)], { type: 'video/mp4' });
  archive = Buffer.from(await (await packProject({ id: 'published-example', name: 'Shared example', updatedAt: 1,
    source: { name: 'example.mp4', assetId: sourceId }, subtitle: null, analysis: emptyAnalysis(),
    interstitials: [{ id: 'example-scene', label: 'Example scene', time: 2, start_range: 2, end_range: 2,
      duration: 6, enable_prompt_expansion: false, prompt: 'Saved example prompt', phase: 'ready',
      result: { assetId: sceneId, url: 'https://fal.media/expired.mp4', start: 1, duration: 2, totalDuration: 4 } }],
  }, [{ id: sourceId, name: 'example.mp4', blob }, { id: sceneId, name: 'scene.mp4', blob }], new AbortController().signal, () => {})).arrayBuffer());
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async ({ suggestedName }: { suggestedName: string }) =>
      (await navigator.storage.getDirectory()).getFileHandle(suggestedName, { create: true }) });
  });
  await page.route('**/api/status', async route => {
    const body = await (await route.fetch()).json();
    await route.fulfill({ json: { ...body, requiresPassword: true, defaultProject: { url: exampleUrl } } });
  });
  await page.route('https://fal.media/**', route => route.abort());
  await page.route('**/media/episode_mock.mp4', route => route.fulfill({ contentType: 'video/mp4', body: video }));
});
const activeProject = (page: Page) => page.evaluate(async () => {
  const { readActiveProject } = await import('/src/features/project/database.ts' as string);
  return readActiveProject();
});
async function openExample(page: Page) {
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open example project', exact: true }).click();
}
async function ready(page: Page) {
  await expect(page.locator('.rendered-interstitial')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Add interstitial/ })).toBeEnabled();
}

test('opens the example project from the sample projects section', async ({ page }) => {
  await page.route(exampleUrl, route => route.fulfill({ contentType: 'application/zip', body: archive }));
  await page.goto('/');
  await page.getByRole('region', { name: 'Sample projects' }).getByRole('button', { name: /Example project/ }).click();
  await ready(page);
  expect((await activeProject(page)).interstitials[0].prompt).toBe('Saved example prompt');
});

test('starts on the chooser and opens the example only when requested', async ({ page }) => {
  let downloads = 0;
  await page.route(exampleUrl, route => { downloads++; return route.fulfill({ contentType: 'application/zip', body: archive }); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose a project' })).toBeVisible();
  expect(downloads).toBe(0);
  await page.getByRole('button', { name: /Sample video/ }).click();
  await expect(page.locator('.menu-document')).toHaveText('episode_mock.mp4');
  await expect(page.getByRole('button', { name: /^Add interstitial/ })).toBeEnabled();
  expect((await activeProject(page)).interstitials).toEqual([]);
  expect(downloads).toBe(0);
  await openExample(page); await ready(page);
  await page.getByRole('button', { name: 'Select Example scene', exact: true }).click();
  await page.getByLabel('Interstitial prompt').fill('My local edit');
  await expect.poll(async () => (await activeProject(page)).interstitials[0].prompt).toBe('My local edit');
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save project' }).click();
  await expect.poll(() => page.evaluate(async () => {
    const { listRecentFiles } = await import('/src/features/project/database.ts' as string); return (await listRecentFiles()).length;
  })).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose a project' })).toBeVisible();
  expect(downloads).toBe(1);
  await page.getByRole('region', { name: 'Recent projects' }).getByRole('button', { name: 'Open' }).click();
  await ready(page);
  expect((await activeProject(page)).interstitials[0].prompt).toBe('My local edit');
  await openExample(page); await ready(page);
  await expect.poll(async () => (await activeProject(page)).interstitials[0].prompt).toBe('Saved example prompt');
  expect(downloads).toBe(2);
});

test('uses only the video from the example archive when no hosted video URL exists', async ({ page }) => {
  let downloads = 0;
  await page.route('**/api/status', async route => {
    const body = await (await route.fetch()).json();
    await route.fulfill({ json: { ...body, defaultVideo: { ...body.defaultVideo, url: '' }, defaultProject: { url: exampleUrl } } });
  });
  await page.route(exampleUrl, route => { downloads++; return route.fulfill({ contentType: 'application/zip', body: archive }); });
  await page.goto('/');
  await page.getByRole('button', { name: /Sample video/ }).click();
  await expect(page.getByRole('button', { name: /^Add interstitial/ })).toBeEnabled();
  await expect(page.locator('.menu-document')).toHaveText('episode_mock.mp4');
  expect((await activeProject(page)).interstitials).toEqual([]);
  expect(downloads).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: /Sample video/ }).click();
  await expect(page.getByRole('button', { name: /^Add interstitial/ })).toBeEnabled();
  expect((await activeProject(page)).interstitials).toEqual([]);
  expect(downloads).toBe(1);
});

test('failed example downloads and corrupt archives leave the sample open and can be retried', async ({ page }) => {
  let attempt = 0;
  await page.route(exampleUrl, route => {
    attempt++;
    return attempt === 1 ? route.fulfill({ status: 503, body: 'Unavailable' })
      : route.fulfill({ contentType: 'application/zip', body: attempt === 2 ? Buffer.from('broken archive') : archive });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Sample video/ }).click();
  await expect(page.getByRole('button', { name: /^Add interstitial/ })).toBeEnabled();
  const sample = await activeProject(page);
  await openExample(page);
  await expect(page.getByRole('alert')).toContainText('503');
  expect((await activeProject(page)).id).toBe(sample.id);
  await openExample(page);
  await expect(page.getByLabel('Cancel project operation')).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await activeProject(page)).id).toBe(sample.id);
  await openExample(page); await ready(page);
  expect(attempt).toBe(3);
});

test('cancels an example download without replacing the sample', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let attempt = 0;
  await page.route(exampleUrl, async route => {
    if (++attempt === 1) await pending;
    await route.fulfill({ contentType: 'application/zip', body: archive }).catch(() => {});
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Sample video/ }).click();
  await expect(page.getByRole('button', { name: /^Add interstitial/ })).toBeEnabled();
  const sample = await activeProject(page);
  await openExample(page);
  await expect(page.getByRole('status').filter({ hasText: 'Downloading example project' })).toBeVisible();
  await page.getByLabel('Cancel project operation').click();
  await expect(page.getByLabel('Cancel project operation')).toHaveCount(0);
  expect((await activeProject(page)).id).toBe(sample.id);
  release();
  await openExample(page); await ready(page);
});
