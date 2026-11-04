import { test, expect, openVideo, addDraft, readProject, fitAll } from './fixtures';

test('Delete and Space respect text editing while clip deletion remains undoable', async ({ page }) => {
  await openVideo(page); await addDraft(page, 'Editable clip');
  const prompt = page.getByLabel('Video prompt'); await prompt.fill('Keep these words');
  await prompt.press('End'); await prompt.press('Space'); await prompt.press('Delete');
  await expect(prompt).toHaveValue('Keep these words '); await expect(page.locator('.story-clip')).toHaveCount(2);
  await page.locator('.story-clip.selected .story-clip-title').click(); await page.keyboard.press('Delete');
  await expect(page.locator('.story-clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.story-clip')).toHaveCount(2);
  expect((await readProject(page)).interstitials[0].prompt).toBe('Keep these words ');
});

test.describe('touch timeline', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('touch selects clips and edits their properties without horizontal overflow', async ({ page }) => {
    await openVideo(page); await addDraft(page); await fitAll(page);
    await page.locator('.story-clip.type-simple .story-clip-title').tap();
    await page.getByLabel('Clip name', { exact: true }).fill('Touch scene'); await page.getByLabel('Clip name', { exact: true }).press('Enter');
    await expect(page.locator('.story-clip.type-simple .story-clip-title')).toContainText('Touch scene');
    await page.getByRole('button', { name: 'Delete selected clips' }).tap(); await expect(page.locator('.story-clip')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
