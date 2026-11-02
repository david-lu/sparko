import { expect, test, openVideo, seekSource, addDraft, saveAndReopen } from './fixtures';

test.beforeEach(async ({ page }) => { await openVideo(page); });

test('fullscreen timeline can be hidden, restored and remembered without losing editing state', async ({ page }) => {
  const timeline = page.locator('.story-canvas'), stage = page.locator('.video-stage');
  await addDraft(page, 'Retained draft');
  await page.getByLabel('Interstitial prompt').fill('Remember this prompt');
  await stage.hover(); await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('player-card'))).toBe(true);
  await expect(timeline).toBeVisible();
  const shownHeight = (await stage.boundingBox())!.height;
  await page.getByRole('button', { name: 'Hide timeline', exact: true }).click();
  await expect(timeline).toBeHidden();
  expect((await stage.boundingBox())!.height).toBeGreaterThan(shownHeight);
  await page.getByRole('button', { name: 'Show timeline', exact: true }).press('Space');
  await expect(timeline).toBeVisible();
  await expect(page.locator('.story-clip.selected .story-clip-title')).toContainText('Retained draft');
  await stage.hover(); await page.getByRole('button', { name: 'Hide timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect(timeline).toBeVisible();
  await saveAndReopen(page);
  await stage.hover(); await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect(timeline).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show timeline', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => document.exitFullscreen());
  await expect(timeline).toBeVisible();
});

test('fullscreen controls follow mouse activity and remain available during interaction', async ({ page }) => {
  const stage = page.locator('.video-stage');
  const controls = page.locator('.transport');
  await stage.hover();
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await page.mouse.move(120, 120);
  await expect(controls).toHaveCSS('opacity', '1');
  // Simply hovering the video must not keep the controls on screen.
  await expect(controls).toHaveCSS('opacity', '0', { timeout: 6000 });
  await expect(controls).toHaveCSS('pointer-events', 'none');
  await page.mouse.move(130, 120);
  await expect(controls).toHaveCSS('opacity', '1');
  await expect(controls).toHaveCSS('pointer-events', 'auto');

  await page.getByRole('button', { name: 'Hide timeline', exact: true }).hover();
  await page.waitForTimeout(2800);
  await expect(controls).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Hide timeline', exact: true }).click();
  await page.mouse.move(140, 120);
  await expect(controls).toHaveCSS('opacity', '0', { timeout: 6000 });
  await page.screenshot({ path: 'test-results/fullscreen-controls-idle.png' });

  // Hidden controls stay reachable with a keyboard, even after the idle timeout.
  await page.keyboard.press('Tab');
  const restore = page.getByRole('button', { name: 'Show timeline', exact: true });
  await restore.focus();
  await page.waitForTimeout(2800);
  await expect(controls).toHaveCSS('opacity', '1');
  await expect(restore).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('.story-canvas')).toBeVisible();
  await page.mouse.move(150, 120);
  await page.screenshot({ path: 'test-results/fullscreen-controls-active.png' });
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  // The normal editor retains its existing hover behavior after fullscreen exits.
  await stage.hover();
  await page.waitForTimeout(2800);
  await expect(controls).toHaveCSS('opacity', '1');
});

test('fullscreen timeline controls remain reachable on narrow screens', async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('.video-stage').hover();
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect(page.locator('.story-canvas')).toBeVisible();
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    for (const name of ['Hide timeline', 'Exit fullscreen']) {
      const button = page.getByRole('button', { name, exact: true });
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
    }
    await page.getByRole('button', { name: 'Hide timeline', exact: true }).click();
    await expect(page.locator('.story-canvas')).toBeHidden();
    await page.getByRole('button', { name: 'Show timeline', exact: true }).click();
    await expect(page.locator('.story-canvas')).toBeVisible();
    await seekSource(page, 1);
    await page.locator('.video-stage').hover();
    await page.screenshot({ path: `test-results/fullscreen-timeline-${width}.png` });
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  }
});
