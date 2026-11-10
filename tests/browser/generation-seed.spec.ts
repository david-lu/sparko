import { test, expect, openVideo, addBridge, readProject, saveAndReopen, fitAll } from './fixtures';

for (const width of [1440, 390]) test(`seed settings support exact integers, undo and project persistence at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await openVideo(page); await addBridge(page);
  const mode = page.getByLabel('Generation seed mode', { exact: true });
  const value = page.getByLabel('Generation seed value', { exact: true });
  const seed = String(Number.MAX_SAFE_INTEGER);
  await expect(mode).toHaveValue('random'); await expect(value).toBeDisabled();
  await mode.selectOption('fixed'); await value.fill(seed); await value.blur();
  await expect(value).toHaveValue(seed);
  expect(await value.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);
  expect((await readProject(page)).interstitials[0].seed).toBe(Number.MAX_SAFE_INTEGER);
  await mode.selectOption('random'); await mode.blur();
  await expect(value).toBeDisabled();
  expect((await readProject(page)).interstitials[0].seed).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(mode).toHaveValue('fixed'); await expect(value).toHaveValue(seed);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(mode).toHaveValue('random'); await expect(value).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.generation-seed')).toContainText('Upscale to 2K has no seed control');
  await page.locator('.generation-seed').screenshot({ path: `test-results/generation-seed-${width}.png` });
  expect(await page.locator('.generation-seed').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await saveAndReopen(page); await fitAll(page);
  await page.locator('.story-clip.type-simple .story-clip-title').click();
  await expect(mode).toHaveValue('fixed'); await expect(value).toHaveValue(seed);
});
