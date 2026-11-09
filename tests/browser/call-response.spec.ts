import { openGenerationTimeline, closeGenerationTimeline, test, expect, openVideo, addQuestionTemplate, readProject, saveAndReopen, fitAll } from './fixtures';

// Question/response is now a graph template: clips and behaviors are edited independently.
for (const width of [1440, 390]) test(`template durations and conditions are independent and persist at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page); await addQuestionTemplate(page);
  const clip = (name: string) => page.locator('.story-clip-title').filter({ hasText: name });
  await clip('Celebrate').press('Enter'); await openGenerationTimeline(page); await page.getByLabel('Duration', { exact: true }).fill('8'); await closeGenerationTimeline(page);
  await page.getByRole('button', { name: 'Auto layout', exact: true }).click(); await fitAll(page);
  await clip('Encourage').press('Enter'); await openGenerationTimeline(page); await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('6'); await closeGenerationTimeline(page);
  await clip('Wait for the viewer').press('Enter');
  await expect(page.getByRole('checkbox', { name: 'Loop', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Conditional', exact: true })).toBeChecked();
  await page.getByLabel('Condition 1 label', { exact: true }).fill('Ready');
  await page.getByRole('button', { name: '+ Add condition', exact: true }).click();
  await page.getByLabel('Condition 3 label', { exact: true }).fill('More time');
  await saveAndReopen(page); await fitAll(page);
  const project = await readProject(page);
  expect(project.interstitials.find((item: any) => item.label === 'Celebrate').duration).toBe(8);
  expect(project.interstitials.find((item: any) => item.label === 'Encourage').duration).toBe(6);
  await clip('Wait for the viewer').press('Enter');
  await expect(page.getByLabel('Condition 1 label', { exact: true })).toHaveValue('Ready');
  await expect(page.getByLabel('Condition 3 label', { exact: true })).toHaveValue('More time');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('removing a template group is undoable and preserves its clips', async ({ page }) => {
  await openVideo(page); await addQuestionTemplate(page);
  await page.locator('.story-group-header').click();
  await page.keyboard.press('Delete'); await expect(page.locator('.story-group')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('.story-group')).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(page.locator('.story-group')).toHaveCount(0);
  await expect(page.locator('.story-clip')).toHaveCount(5);
  await expect(page.locator('.story-clip.type-source')).toHaveCount(1);
});

test('subtitle import can be undone and redone in the graph player', async ({ page }) => {
  await openVideo(page);
  await page.getByLabel('Choose subtitle file').setInputFiles({ name: 'test.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00.000 --> 00:03.000\nAn undoable caption\n') });
  await expect.poll(async () => (await readProject(page)).subtitle?.assetId).toBeTruthy();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await readProject(page)).subtitle).toBeNull();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await readProject(page)).subtitle?.assetId).toBeTruthy();
});
