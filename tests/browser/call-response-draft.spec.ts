import { test, expect, openVideo, addQuestionTemplate, readProject, saveAndReopen, fitAll } from './fixtures';

test('template clips keep independent mask modes and reference switches', async ({ page }) => {
  await openVideo(page); await addQuestionTemplate(page);
  const clip = (name: string) => page.locator('.story-clip-title').filter({ hasText: name });
  await clip('Wait for the viewer').click();
  await page.getByRole('group', { name: 'Loop reference', exact: true }).getByRole('button', { name: 'Video', exact: true }).click();
  await expect(page.locator('.inspector-references-panel')).toHaveAttribute('open', '');
  await page.getByRole('button', { name: /^Mask injection:/ }).click();
  await page.getByRole('radio', { name: /FILM \+ uniform mask/ }).click();
  await expect(page.getByRole('group', { name: 'End reference', exact: true })).toHaveCount(0);
  await clip('Celebrate').click();
  await page.getByRole('group', { name: 'End reference', exact: true }).getByRole('button', { name: 'Video', exact: true }).click();
  await expect(page.locator('.inspector-references-panel')).toHaveAttribute('open', '');
  await page.getByRole('button', { name: /^Mask injection:/ }).click();
  await page.getByRole('radio', { name: /FILM \+ vignette mask/ }).click();
  await clip('Encourage').click();
  await expect(page.locator('.inspector-references-panel')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: /^Mask injection:/ })).toContainText('Standard');
  await saveAndReopen(page); await fitAll(page);
  const items = (await readProject(page)).interstitials;
  expect(items.find((item: any) => item.label === 'Wait for the viewer')).toMatchObject({ maskInjection: 'uniform', useInputReference: true });
  expect(items.find((item: any) => item.label === 'Celebrate')).toMatchObject({ maskInjection: 'vignette' });
  await clip('Wait for the viewer').click();
  await expect(page.locator('.inspector-references-panel')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: /^Mask injection:/ })).toContainText('FILM + uniform');
});
