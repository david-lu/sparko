import { expect, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.locator('.video-stage video').evaluate((video: HTMLVideoElement) => video.duration), { timeout: 60_000 }).toBeGreaterThan(0);
});

test('fullscreen timeline can be hidden, restored and remembered without losing editing state', async ({ page }) => {
  const timeline = page.locator('.timeline-section');
  const stage = page.locator('.video-stage');
  await page.getByRole('slider', { name: 'Video timeline' }).fill('12.5');
  await page.getByRole('button', { name: 'Add interstitial P' }).click();
  await page.getByRole('slider', { name: 'Timeline zoom', exact: true }).fill('2');
  await stage.hover();
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('player-card'))).toBe(true);
  await expect(timeline).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide timeline', exact: true })).toHaveText('');
  const shownHeight = (await stage.boundingBox())!.height;
  await page.getByRole('button', { name: 'Hide timeline', exact: true }).click();
  await expect(timeline).toBeHidden();
  await expect(page.getByRole('slider', { name: 'Video timeline' })).toHaveCount(0);
  expect((await stage.boundingBox())!.height).toBeGreaterThan(shownHeight);
  await expect.poll(() => page.locator('.video-stage video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(12.5, 1);

  // Keyboard activation restores the same timeline, including its zoom and pin selection.
  await page.getByRole('button', { name: 'Show timeline', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(timeline).toBeVisible();
  await expect.poll(() => page.locator('.video-stage video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await expect(page.getByRole('slider', { name: 'Timeline zoom', exact: true })).toHaveValue('2');
  await expect(page.locator('.timeline-marker.selected')).toHaveCount(1);
  await page.getByRole('slider', { name: 'Video timeline' }).fill('30');
  await expect.poll(() => page.locator('.video-stage video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(30, 1);
  await page.getByRole('button', { name: /^Select Untitled at/ }).click();
  await expect.poll(() => page.locator('.video-stage video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(12.5, 1);
  await stage.hover();
  await page.getByRole('button', { name: 'Hide timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(timeline).toBeVisible();

  await page.reload();
  await expect(timeline).toBeVisible();
  await stage.hover();
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect(timeline).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show timeline', exact: true })).toHaveAttribute('aria-expanded', 'false');
  // Browser-initiated exit also restores the normal editor layout.
  await page.evaluate(() => document.exitFullscreen());
  await expect(timeline).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show timeline', exact: true })).toHaveCount(0);
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
  await expect(page.locator('.timeline-section')).toBeVisible();
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
    await expect(page.locator('.timeline-section')).toBeVisible();
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    for (const name of ['Hide timeline', 'Exit fullscreen']) {
      const button = page.getByRole('button', { name, exact: true });
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
    }
    await page.getByRole('button', { name: 'Hide timeline', exact: true }).click();
    await expect(page.locator('.timeline-section')).toBeHidden();
    await page.getByRole('button', { name: 'Show timeline', exact: true }).click();
    await expect(page.locator('.timeline-section')).toBeVisible();
    await page.getByRole('slider', { name: 'Video timeline' }).fill('10');
    await expect.poll(() => page.locator('.video-stage video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(10, 1);
    await page.locator('.video-stage').hover();
    await page.screenshot({ path: `test-results/fullscreen-timeline-${width}.png` });
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  }
});
