import { test, expect, type Page } from './fixtures';
import type { Locator } from '@playwright/test';

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled();
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.story-playhead')).toBeVisible();
}

// Hit testing normally ignores the playhead and other pointer-transparent
// decoration. Include them temporarily so these checks catch visual occlusion,
// even when the menu underneath would still receive clicks.
async function expectOnTop(popup: Locator) {
  const obscured = await popup.evaluate(element => {
    const decorations = Array.from(document.querySelectorAll<HTMLElement>(
      '.story-playhead,.story-playhead *,.story-port,.story-marquee,.story-drop-preview,.story-file-drop,.clip-job-status,.playback-captions,.draft-preview-label',
    ));
    const previous = decorations.map(el => el.style.pointerEvents);
    decorations.forEach(el => { el.style.pointerEvents = 'auto'; });
    try {
      const r = element.getBoundingClientRect(), failures: string[] = [];
      for (let y = Math.max(0, r.top) + 8; y < Math.min(innerHeight, r.bottom) - 8; y += 12) {
        for (let x = Math.max(0, r.left) + 8; x < Math.min(innerWidth, r.right) - 8; x += 12) {
          const hit = document.elementFromPoint(x, y);
          if (!element.contains(hit)) failures.push(`${x},${y}: ${hit?.tagName}.${hit?.getAttribute('class')}`);
        }
      }
      // Check the bottom edge too: a parent's overflow can cut off only the
      // final few pixels where the menu crosses into an adjacent panel.
      if (r.bottom < innerHeight) {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.bottom - 2);
        if (!element.contains(hit)) failures.push(`bottom edge: ${hit?.getAttribute('class')}`);
      }
      const head = document.querySelector('.story-playhead')?.getBoundingClientRect();
      if (head) {
        const x = head.left + head.width / 2, y = Math.max(head.top, r.top) + 8;
        if (x > r.left && x < r.right && y < Math.min(head.bottom, r.bottom)) {
          const hit = document.elementFromPoint(x, y);
          if (!element.contains(hit)) failures.push(`playhead: ${hit?.getAttribute('class')}`);
        }
      }
      return failures;
    } finally { decorations.forEach((el, index) => { el.style.pointerEvents = previous[index]; }); }
  });
  expect(obscured).toEqual([]);
}

async function overlapPlayhead(page: Page, name: string) {
  const menu = page.locator('.story-menu').filter({ has: page.locator('summary', { hasText: name }) });
  await menu.locator('summary').click();
  const popup = (await menu.locator('.story-menu-popover').boundingBox())!;
  await page.keyboard.press('Escape');
  const canvas = page.locator('.story-scroll'), view = (await canvas.boundingBox())!;
  const head = (await page.locator('.story-playhead').boundingBox())!;
  const target = { x: popup.x + 70, y: Math.min(view.y + 65, popup.y + popup.height - 15) };
  const start = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  await page.mouse.move(start.x, start.y); await page.mouse.down({ button: 'middle' });
  await page.mouse.move(start.x + target.x - head.x - head.width / 2, start.y + target.y - head.y - head.height / 2, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await menu.locator('summary').click();
  const moved = (await page.locator('.story-playhead').boundingBox())!;
  expect(moved.x).toBeGreaterThan(popup.x); expect(moved.x).toBeLessThan(popup.x + popup.width);
  expect(moved.y + moved.height).toBeGreaterThan(popup.y); expect(moved.y).toBeLessThan(popup.y + popup.height);
  return menu.locator('.story-menu-popover');
}

for (const width of [1440, 390]) {
  test(`menus paint above playheads, clips, and panel controls at ${width}px`, async ({ page }) => {
    await open(page, width);
    await page.locator('.story-scroll').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.story-clip.selected')).toHaveCount(0);
    const toolbar = await page.locator('.story-toolbar').boundingBox();
    for (const name of ['Interstitial', 'Templates']) {
      const popup = await overlapPlayhead(page, name);
      await expectOnTop(popup);
      await page.screenshot({ path: `test-results/layers-${name}-${width}.png` });
      await page.keyboard.press('Escape');
    }
    // Selected clips create their own stacking contexts too.
    await page.locator('.story-clip-title').click();
    await expectOnTop(await overlapPlayhead(page, 'Templates'));
    await page.keyboard.press('Escape');
    for (const name of ['File', 'Options', 'Window', 'Panels']) {
      const menu = page.locator('details[data-popup-menu]').filter({ has: page.locator('summary', { hasText: new RegExp(`^${name}$`) }) });
      await menu.locator('summary').click(); await expectOnTop(menu.locator(':scope>div'));
      await page.keyboard.press('Escape');
    }
    await page.locator('.story-scroll').click({ button: 'right', position: { x: 15, y: 15 } });
    await expectOnTop(page.locator('.story-context-menu')); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Move Library panel', exact: true }).click({ button: 'right' });
    await expectOnTop(page.locator('.panelContextMenu')); await page.keyboard.press('Escape');
    expect(await page.locator('.story-toolbar').boundingBox()).toEqual(toolbar);
  });

  test(`inspector popovers and modal dialogs stay above the workspace at ${width}px`, async ({ page }) => {
    await open(page, width);
    await page.getByRole('button', { name: 'Add interstitial', exact: true }).dragTo(page.locator('.story-scroll'), { targetPosition: { x: 90, y: 60 } });
    await page.getByRole('spinbutton', { name: 'Duration', exact: true }).click();
    await expectOnTop(page.locator('.interstitial-time-popover')); await page.keyboard.press('Escape');
    await page.locator('.inspector-advanced>summary').click();
    await page.getByRole('button', { name: /^Mask injection:/ }).click();
    await expectOnTop(page.locator('.mask-injection-popover')); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Generation details', exact: true }).click();
    await expectOnTop(page.locator('.inspector-status-popover:popover-open')); await page.keyboard.press('Escape');
    await page.locator('.story-menu summary').filter({ hasText: 'Templates' }).click();
    await page.getByRole('button', { name: 'Save selected clips as template', exact: true }).click();
    const template = page.getByRole('dialog', { name: 'Save selected clips as a template' });
    await expect(template).toBeVisible(); await expectOnTop(template.locator('form'));
    expect(await template.evaluate(el => el.matches(':modal'))).toBe(true);
    await page.keyboard.press('Escape'); await expect(template).toHaveCount(0);
    await expect(page.locator('.story-menu summary').filter({ hasText: 'Templates' })).toBeFocused();
    await page.locator('.file-menu>summary').filter({ hasText: /^File$/ }).click();
    await page.getByRole('menuitem', { name: 'Close project', exact: true }).click();
    const close = page.getByRole('dialog', { name: 'Save changes before closing?' });
    await expect(close).toBeVisible(); await expectOnTop(close.locator('.project-card'));
    expect(await close.evaluate(el => el.matches(':modal'))).toBe(true);
    await page.keyboard.press('Escape'); await expect(close).toHaveCount(0);
    await page.getByRole('button', { name: 'Shortcuts', exact: true }).click();
    await expectOnTop(page.getByRole('dialog', { name: 'Keyboard shortcuts' }));
    await page.keyboard.press('Escape');
  });
}

test('fullscreen timeline menus and template dialogs remain above the player', async ({ page }) => {
  await open(page, 1440);
  await page.locator('.video-stage').hover(); await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.locator('.story-clip-title').click();
  await expectOnTop(await overlapPlayhead(page, 'Templates'));
  await page.getByRole('button', { name: 'Save selected clips as template', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save selected clips as a template' });
  await expectOnTop(dialog.locator('form'));
  await page.getByLabel('Template name', { exact: true }).fill('Fullscreen template');
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator('.video-stage').hover(); await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await page.locator('.story-menu summary').filter({ hasText: 'Templates' }).click();
  await expect(page.locator('.story-template-row').getByRole('button', { name: 'Fullscreen template', exact: true })).toBeVisible();
});
