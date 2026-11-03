import { test, expect, openVideo, addQuestionTemplate, readProject, saveAndReopen, fitAll } from './fixtures';

test('template clips keep independent audio/video masks and reference choices', async ({ page }) => {
  await openVideo(page); await addQuestionTemplate(page);
  const clip = (name: string) => page.locator('.story-clip-title').filter({ hasText: name });
  const editMask = async (channel: 'video' | 'audio', strength: string) => {
    await page.getByRole('button', { name: `Edit ${channel} mask`, exact: true }).click();
    await page.getByRole('button', { name: 'Add keyframe', exact: true }).click();
    await page.getByLabel('Keyframe regeneration', { exact: true }).fill(strength);
    await page.getByRole('button', { name: `Apply ${channel} mask`, exact: true }).click();
  };
  await clip('Wait for the viewer').click();
  await page.getByRole('group', { name: 'Loop reference', exact: true }).getByRole('button', { name: 'Video', exact: true }).click();
  await expect(page.locator('.inspector-references-panel')).toHaveAttribute('open', '');
  await editMask('video', '35');
  await expect(page.getByRole('group', { name: 'End reference', exact: true })).toHaveCount(0);
  await clip('Celebrate').click();
  await page.getByRole('group', { name: 'End reference', exact: true }).getByRole('button', { name: 'Video', exact: true }).click();
  await editMask('audio', '65');
  await clip('Encourage').click();
  await expect(page.locator('.inspector-references-panel')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: /^Mask injection:/ })).toHaveCount(0);
  await saveAndReopen(page); await fitAll(page);
  const items = (await readProject(page)).interstitials;
  const waiting = items.find((item: any) => item.label === 'Wait for the viewer');
  const celebrate = items.find((item: any) => item.label === 'Celebrate');
  const encourage = items.find((item: any) => item.label === 'Encourage');
  expect(waiting).toMatchObject({ useInputReference: true, videoMaskCurve: { start: expect.arrayContaining([expect.objectContaining({ strength: .35 })]) } });
  expect(waiting.audioMaskCurve).toBeUndefined();
  expect(celebrate).toMatchObject({ useOutputReference: true, audioMaskCurve: { start: expect.arrayContaining([expect.objectContaining({ strength: .65 })]) } });
  expect(celebrate.videoMaskCurve).toBeUndefined();
  expect(encourage.audioMaskCurve).toBeUndefined(); expect(encourage.videoMaskCurve).toBeUndefined();
  await clip('Wait for the viewer').click();
  await page.getByRole('button', { name: 'Edit video mask', exact: true }).click();
  await page.getByRole('button', { name: 'Video start keyframe 2', exact: true }).focus();
  await expect(page.getByLabel('Keyframe regeneration', { exact: true })).toHaveValue('35');
});
