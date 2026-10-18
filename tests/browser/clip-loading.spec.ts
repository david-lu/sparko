import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  const video = await readFile('tests/fixtures/interstitial-reference.mp4');
  await page.route('**/__clips/*.mp4', route => route.fulfill({ contentType: 'video/mp4', body: video }));
  await page.route('**/__clips/broken.mp4', route => route.fulfill({ status: 404, body: 'Missing clip' }));
  await page.route('**/__clip-loading', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('/src/main.tsx', '/tests/browser/clip-loading-harness.tsx') });
  });
});

async function dimensions(page: Page) {
  return page.locator('#strip, #narrow-strip, .clip-preview-stage').evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height };
  }));
}

for (const width of [1440, 390]) {
  test(`clip thumbnails and preview show loading without shifting at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/__clips/slow.mp4', async route => { await pending; await route.fallback(); });
    await page.goto('/__clip-loading', { waitUntil: 'domcontentloaded' });
    const strip = page.locator('#strip'), preview = page.locator('.clip-preview-stage');
    await expect(strip.getByRole('status', { name: 'Loading clip…' })).toBeVisible();
    await expect(preview.getByRole('status', { name: 'Loading preview…' })).toBeVisible();
    await expect(page.locator('#narrow-strip .clip-loading-label')).toBeHidden();
    const loading = await dimensions(page);
    release();
    await expect(strip.locator('img').first()).toBeVisible();
    await expect(preview.getByRole('status')).toHaveCount(0);
    expect(await dimensions(page)).toEqual(loading);

    await preview.locator('video').evaluate(video => video.dispatchEvent(new Event('waiting')));
    await expect(preview.getByRole('status', { name: 'Loading preview…' })).toBeVisible();
    expect(await dimensions(page)).toEqual(loading);
    await preview.locator('video').evaluate(video => video.dispatchEvent(new Event('canplay')));
    await expect(preview.getByRole('status')).toHaveCount(0);

    await page.getByRole('button', { name: 'Fail clip' }).click();
    await expect(strip.getByRole('status', { name: 'Preview unavailable' })).toBeVisible();
    await expect(preview.getByRole('status', { name: 'Unable to load preview' })).toBeVisible();
    await expect(strip.locator('.spinner')).toHaveCount(0);
    expect(await dimensions(page)).toEqual(loading);
    await page.getByRole('button', { name: 'Switch clip' }).click();
    await expect(strip.locator('img').first()).toBeVisible();
    await expect(preview.getByRole('status')).toHaveCount(0);
  });
}

test('replacing a loading clip ignores its late result and generation keeps the existing filmstrip', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/__clips/slow.mp4', async route => { await pending; await route.fulfill({ status: 404, body: 'Old clip failed' }).catch(() => {}); });
  await page.goto('/__clip-loading', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#strip .clip-loading')).toBeVisible();
  await page.getByRole('button', { name: 'Switch clip' }).click();
  await expect(page.locator('#strip img').first()).toBeVisible();
  await expect(page.locator('.clip-preview-stage .clip-loading')).toHaveCount(0);
  release();

  const clip = page.locator('[data-scene-id="call"]');
  await expect(clip.locator('img').first()).toBeVisible();
  const before = await clip.boundingBox();
  await page.getByRole('button', { name: 'Render clips' }).click();
  await expect(clip.getByRole('status')).toHaveAttribute('aria-label', /Generating scene/);
  await expect(clip.locator('img').first()).toBeVisible();
  expect(await clip.boundingBox()).toEqual(before);
  await page.getByRole('button', { name: 'Finish generation' }).click();
  await expect(clip.getByRole('status')).toHaveCount(0);
  await expect(page.locator('#strip .clip-loading')).toHaveCount(0);
  await expect(page.locator('.clip-preview-stage .clip-loading')).toHaveCount(0);
});

test('zoom stretches the existing filmstrip without loading more frames', async ({ page }) => {
  await page.goto('/__clip-loading', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Switch clip' }).click();
  const strip = page.locator('#strip .video-filmstrip');
  await expect(strip.locator('img')).toHaveCount(1);
  await expect(strip).toHaveAttribute('aria-busy', 'false');
  const beforeWidth = await strip.evaluate(element => {
    (window as Window & { initialFrame?: Element }).initialFrame = element.querySelector('img') ?? undefined;
    return element.getBoundingClientRect().width;
  });
  await page.getByRole('button', { name: 'Zoom filmstrip' }).click();
  await expect(strip.locator('img')).toHaveCount(1);
  await expect(strip).toHaveAttribute('aria-busy', 'false');
  expect(await strip.evaluate(element => element.querySelector('img') === (window as Window & { initialFrame?: Element }).initialFrame)).toBe(true);
  expect((await strip.boundingBox())!.width).toBeGreaterThan(beforeWidth);
});

test('splitting a clip reuses its video asset thumbnails without showing a new loading state', async ({ page }) => {
  await page.goto('/__clip-loading', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Switch clip' }).click();
  const first = page.locator('#strip .video-filmstrip');
  await expect(first.locator('img').first()).toBeVisible();
  await page.getByRole('button', { name: 'Split clip' }).click();
  const second = page.locator('#split-strip .video-filmstrip');
  await expect(first.locator('img').first()).toBeVisible();
  await expect(second.locator('img').first()).toBeVisible();
  await expect(page.locator('#strip .clip-loading, #split-strip .clip-loading')).toHaveCount(0);
});
