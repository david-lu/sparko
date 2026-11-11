import { openGenerationTimeline, closeGenerationTimeline, setVideoReference, expect, test, openVideo, addBridge, saveAndReopen } from './fixtures';

test('reference and duration sliders synchronize with inputs and persist', { tag: '@flaky' }, async ({ page }) => {
  await page.route('**/api/status', async route => { const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { comfy: true } } }); });
  await openVideo(page); await addBridge(page);
  await setVideoReference(page, 'end', true);
  await page.getByLabel('Video prompt').fill('A green video scene');
  await openGenerationTimeline(page);
  for (const [name, label, value] of [['start_range', 'Duration', '1.8'], ['end_range', 'Duration', '1.7'], ['Duration', 'Duration', '7.5']]) {
    const number = page.getByRole('spinbutton', { name, exact: true });
    await number.click(); const slider = page.getByRole('slider', { name: `${label} slider`, exact: true });
    await slider.fill(value); await expect(number).toHaveValue(value);
    await number.fill('2'); await expect(slider).toHaveValue('2');
    await number.fill(value); await slider.press('Escape');
    await expect(slider).toHaveCount(0); await expect(number).toBeFocused();
  }
  await closeGenerationTimeline(page); await saveAndReopen(page); await page.locator('.story-clip.type-simple .story-clip-title').click();
  await openGenerationTimeline(page);
  await expect(page.getByLabel('start_range', { exact: true })).toHaveValue('1.8');
  await expect(page.getByLabel('end_range', { exact: true })).toHaveValue('1.7');
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('7.5');
});
