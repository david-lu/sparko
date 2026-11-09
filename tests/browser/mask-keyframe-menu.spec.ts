import { test, expect, openVideo, addBridge, readProject } from './fixtures';

for (const width of [1440, 390]) test(`mask curves support click-to-add and keyframe context menus at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openVideo(page); await addBridge(page);
  await page.getByRole('button', { name: 'Expand generation timeline', exact: true }).click();
  let savedVideo: unknown;
  for (const channel of ['video', 'audio']) {
    const title = channel === 'video' ? 'Video' : 'Audio';
    await page.getByRole('button', { name: `Edit ${channel} mask`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Generation timeline', exact: true });
    const menu = dialog.getByRole('menu', { name: 'Mask keyframe actions' });
    const keys = dialog.locator('.mask-keyframe-hit');
    const key = (side: string, index: number) => dialog.getByRole('button', { name: `${title} ${side} keyframe ${index}`, exact: true });
    const positions = () => dialog.locator('.mask-editor-graph,.mask-keyframe-properties,.mask-editor-footer').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));
    await dialog.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(keys).toHaveCount(3);
    await key('start', 3).focus();
    const before = Number(await dialog.getByLabel('Keyframe time', { exact: true }).inputValue());
    const plot = (await dialog.locator('.mask-plot-background').boundingBox())!;
    // A single click halfway up the default half-second ramp adds a point on the curve.
    await page.mouse.click(plot.x + plot.width * (before - .25) / before, plot.y + plot.height / 2);
    await expect(keys).toHaveCount(4);
    expect(Math.abs(Number(await dialog.getByLabel('Keyframe time', { exact: true }).inputValue()) - (before - .25))).toBeLessThan(1 / 24);
    expect(Math.abs(Number(await dialog.getByLabel('Keyframe regeneration').inputValue()) - 50)).toBeLessThan(1.5);
    await key('start', 3).click(); await expect(keys).toHaveCount(4);
    await dialog.getByRole('button', { name: 'Undo mask edit' }).click(); await expect(keys).toHaveCount(3);
    await dialog.getByRole('button', { name: 'Redo mask edit' }).click(); await expect(keys).toHaveCount(4);

    await key('start', 3).focus();
    const idle = await positions();
    await page.mouse.click(plot.x + plot.width * .3, plot.y + plot.height * .4, { button: 'right' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Add keyframe' })).toBeEnabled();
    await expect(menu.getByRole('menuitem', { name: 'Delete keyframe' })).toBeDisabled();
    expect(await positions()).toEqual(idle);
    await menu.getByRole('menuitem', { name: 'Add keyframe' }).click();
    await expect(keys).toHaveCount(5); await expect(menu).toHaveCount(0);
    expect(Math.abs(Number(await dialog.getByLabel('Keyframe time', { exact: true }).inputValue()) - before * .3)).toBeLessThan(1 / 24);
    expect(Math.abs(Number(await dialog.getByLabel('Keyframe regeneration').inputValue()) - 60)).toBeLessThan(1);

    // Delete the point under the pointer, even when a different point was selected.
    await key('start', 4).click({ button: 'right' });
    await expect(menu.getByRole('menuitem', { name: 'Delete keyframe' })).toBeFocused();
    await expect(menu.getByRole('menuitem', { name: 'Add keyframe' })).toBeDisabled();
    await page.keyboard.press('Enter'); await expect(keys).toHaveCount(4);
    await dialog.getByRole('button', { name: 'Undo mask edit' }).click(); await expect(keys).toHaveCount(5);
    await dialog.getByRole('button', { name: 'Redo mask edit' }).click(); await expect(keys).toHaveCount(4);
    await key('start', 2).focus(); await page.keyboard.press('Shift+F10');
    await expect(menu.getByRole('menuitem', { name: 'Delete keyframe' })).toBeEnabled();
    await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(key('start', 2)).toBeFocused();
    await expect(dialog).toBeVisible();

    // Endpoints and the fully generated middle cannot be removed or given extra pins.
    await key('start', 1).click({ button: 'right' });
    await expect(menu.getByRole('menuitem', { name: 'Delete keyframe' })).toBeDisabled();
    await expect(menu.getByRole('menuitem', { name: 'Add keyframe' })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(key('start', 1)).toBeFocused();
    await dialog.getByRole('button', { name: 'Fit', exact: true }).click();
    await dialog.locator('.mask-editor-graph .mask-generated-region').click({ button: 'right' });
    await expect(menu.getByRole('menuitem', { name: 'Add keyframe' })).toBeDisabled();
    await expect(menu.getByRole('menuitem', { name: 'Delete keyframe' })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'End', exact: true }).click();
    await key('end', 1).focus();
    const endStart = Number(await dialog.getByLabel('Keyframe time', { exact: true }).inputValue());
    await key('end', 3).focus();
    const after = Number(await dialog.getByLabel('Keyframe time', { exact: true }).inputValue()) - endStart;
    const endPlot = (await dialog.locator('.mask-plot-background').boundingBox())!;
    await page.mouse.click(endPlot.x + endPlot.width * .25 / after, endPlot.y + endPlot.height / 2);
    await expect(keys).toHaveCount(4);
    expect(Math.abs(Number(await dialog.getByLabel('Keyframe time', { exact: true }).inputValue()) - endStart - .25)).toBeLessThan(1 / 24);
    await key('end', 4).click({ button: 'right' });
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(8); expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height - 8);
    expect(await menu.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true);
    await page.screenshot({ path: `test-results/${channel}-mask-menu-${width}.png` });
    // Clicking another control dismisses the menu and performs that action.
    await dialog.getByRole('button', { name: 'Fit', exact: true }).click(); await expect(menu).toHaveCount(0);
    await dialog.getByRole('button', { name: `Apply ${channel} mask`, exact: true }).click();
    const saved = (await readProject(page)).interstitials[0];
    expect(saved[`${channel}MaskCurve`].start).toHaveLength(4);
    expect(saved[`${channel}MaskCurve`].end).toHaveLength(4);
    if (channel === 'video') { savedVideo = saved.videoMaskCurve; expect(saved.audioMaskCurve).toBeUndefined(); }
    else expect(saved.videoMaskCurve).toEqual(savedVideo);
  }
  // Cancelling a context-menu edit preserves the saved curve.
  const saved = (await readProject(page)).interstitials[0].audioMaskCurve;
  await page.getByRole('button', { name: 'Edit audio mask', exact: true }).click();
  const audio = page.getByRole('dialog', { name: 'Generation timeline', exact: true });
  await audio.getByRole('button', { name: 'Start', exact: true }).click();
  await audio.getByRole('button', { name: 'Audio start keyframe 2', exact: true }).click({ button: 'right' });
  await audio.getByRole('menuitem', { name: 'Delete keyframe' }).click();
  await audio.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await readProject(page)).interstitials[0].audioMaskCurve).toEqual(saved);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(errors).toEqual([]);
});
