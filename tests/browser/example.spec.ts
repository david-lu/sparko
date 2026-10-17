import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { packProject } from '../../src/features/project/archive';
import { emptyAnalysis } from '../../src/features/project/types';

const exampleUrl = 'https://example.public.blob.vercel-storage.com/defaults/example.sparko';
let archive: Buffer;
test.beforeAll(async () => {
  const sourceId = crypto.randomUUID(), sceneId = crypto.randomUUID();
  const blob = new Blob([await readFile('tests/fixtures/interstitial-reference.mp4')], { type: 'video/mp4' });
  archive = Buffer.from(await (await packProject({ id: 'published-example', name: 'Shared example', updatedAt: 1,
    source: { name: 'example.mp4', assetId: sourceId }, subtitle: null, analysis: emptyAnalysis(),
    interstitials: [{ id: 'example-scene', label: 'Example scene', time: 2, start_range: 2, end_range: 2,
      duration: 6, enable_prompt_expansion: false, prompt: 'Saved example prompt', phase: 'ready',
      result: { assetId: sceneId, url: 'https://fal.media/expired.mp4', start: 1, duration: 2, totalDuration: 4 } }],
  }, [{ id: sourceId, name: 'example.mp4', blob }, { id: sceneId, name: 'scene.mp4', blob }], new AbortController().signal, () => {})).arrayBuffer());
});
test.beforeEach(async ({ page }) => {
  await page.route('**/api/status', async route => {
    const body = await (await route.fetch()).json();
    await route.fulfill({ json: { ...body, requiresPassword: true, defaultProject: { url: exampleUrl } } });
  });
  await page.route('https://fal.media/**', route => route.abort());
  await page.route('**/media/episode_mock.mp4', route => route.abort());
});
const activeProject = (page: Page) => page.evaluate(async () => {
  const { readActiveProject } = await import('/src/features/project/database.ts' as string);
  return readActiveProject();
});
const ready = async (page: Page) => {
  await expect(page.locator('.rendered-interstitial')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Add draft/ })).toBeEnabled();
  await expect(page.getByLabel('Cancel project operation')).toHaveCount(0);
};

test('seeds a fresh browser, keeps edits on reload, and explicitly opens a separate example copy', async ({ page }) => {
  let downloads = 0;
  await page.route(exampleUrl, route => { downloads++; return route.fulfill({ contentType: 'application/zip', body: archive }); });
  await page.goto('/'); await ready(page);
  const first = await activeProject(page);
  expect(first.name).toBe('Shared example');
  expect(first.id).not.toBe('published-example');
  await page.getByRole('button', { name: 'Select Example scene', exact: true }).click();
  await page.getByLabel('Interstitial prompt').fill('My local edit');
  await expect.poll(async () => (await activeProject(page)).interstitials[0].prompt).toBe('My local edit');
  await page.reload(); await ready(page);
  expect((await activeProject(page)).interstitials[0].prompt).toBe('My local edit');
  expect(downloads).toBe(1);
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.menu-document')).toHaveText('interstitial-reference.mp4');
  const local = await activeProject(page);
  await page.reload();
  await expect(page.locator('.menu-document')).toHaveText('interstitial-reference.mp4');
  expect((await activeProject(page)).id).toBe(local.id); expect(downloads).toBe(1);
  await page.locator('.file-menu summary').click();
  await page.getByRole('menuitem', { name: 'Open example project', exact: true }).click();
  await ready(page);
  const second = await activeProject(page);
  expect(second.id).not.toBe(first.id); expect(second.source.assetId).not.toBe(first.source.assetId);
  expect(second.interstitials[0].prompt).toBe('Saved example prompt'); expect(downloads).toBe(2);
  const retained = await page.evaluate(async id => {
    const { readProject } = await import('/src/features/project/database.ts' as string); return readProject(id);
  }, first.id);
  expect(retained.interstitials[0].prompt).toBe('My local edit');
});

test('failed example downloads and corrupt archives are retryable without saving partial projects', async ({ page }) => {
  let attempt = 0;
  await page.route(exampleUrl, route => {
    attempt++;
    return attempt === 1 ? route.fulfill({ status: 503, body: 'Unavailable' })
      : route.fulfill({ contentType: 'application/zip', body: attempt === 2 ? Buffer.from('broken archive') : archive });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('503'); expect(await activeProject(page)).toBeUndefined();
  await page.locator('.file-menu summary').click();
  await page.getByRole('menuitem', { name: 'Open example project', exact: true }).click();
  await expect(page.getByLabel('Cancel project operation')).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeVisible(); expect(await activeProject(page)).toBeUndefined();
  await page.locator('.file-menu summary').click();
  await page.getByRole('menuitem', { name: 'Open example project', exact: true }).click();
  await ready(page); expect(attempt).toBe(3);
});

test('cancels an example download without activating it and can retry', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let attempt = 0;
  await page.route(exampleUrl, async route => {
    if (++attempt === 1) await pending;
    await route.fulfill({ contentType: 'application/zip', body: archive }).catch(() => {});
  });
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Downloading example project' })).toBeVisible();
  await page.getByLabel('Cancel project operation').click();
  await expect(page.getByLabel('Cancel project operation')).toHaveCount(0);
  expect(await activeProject(page)).toBeUndefined(); release();
  await page.locator('.file-menu summary').click();
  await page.getByRole('menuitem', { name: 'Open example project', exact: true }).click();
  await ready(page);
});
