import { expect, openVideo, readProject, saveAndReopen, test } from './fixtures';
import { wavFixture } from '../fixtures/audio';

for (const width of [1440, 390]) test(`audio layers overlap, edit, undo and persist at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await openVideo(page);
  await page.getByRole('button', { name: 'Edit audio layers', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Audio layers', exact: true });
  await dialog.getByLabel('Upload audio layers', { exact: true }).setInputFiles([
    { name: 'Music.wav', mimeType: 'audio/wav', buffer: wavFixture(5) },
    { name: 'Voice.wav', mimeType: 'audio/wav', buffer: wavFixture(3) },
  ]);
  await expect(dialog.locator('.audio-layer')).toHaveCount(2);
  await expect(page.locator('.story-clip')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Play with audio layers', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Pause audio preview', exact: true })).toBeVisible();
  await expect.poll(async () => Number((await dialog.locator('.audio-layers-transport>span').textContent())!.replace(' s', ''))).toBeGreaterThan(.1);
  await expect(dialog.locator('.audio-layers-feedback')).toBeEmpty();
  await dialog.getByRole('button', { name: 'Pause audio preview', exact: true }).click();
  const voice = dialog.getByRole('group', { name: 'Audio layer Voice.wav', exact: true });
  await voice.getByLabel('Start (s)', { exact: true }).fill('1.25'); await voice.getByLabel('Start (s)', { exact: true }).press('Enter');
  await voice.getByLabel('In (s)', { exact: true }).fill('.5'); await voice.getByLabel('In (s)', { exact: true }).press('Enter');
  await voice.getByLabel('Out (s)', { exact: true }).fill('2.5'); await voice.getByLabel('Out (s)', { exact: true }).press('Enter');
  await voice.getByRole('slider', { name: 'Volume Voice.wav', exact: true }).fill('40');
  await voice.getByRole('button', { name: 'Mute Voice.wav', exact: true }).click();
  await expect.poll(async () => (await readProject(page)).audioLayers[1]).toMatchObject({ startFrame: 30, inFrame: 12, outFrame: 60, volume: .4, muted: true });
  await voice.getByRole('slider', { name: 'Position Voice.wav', exact: true }).press('Shift+ArrowRight');
  await expect.poll(async () => (await readProject(page)).audioLayers[1].startFrame).toBe(54);
  await voice.getByRole('button', { name: 'Duplicate Voice.wav', exact: true }).click();
  await expect(dialog.locator('.audio-layer')).toHaveCount(3);
  const before = (await readProject(page)).audioLayers;
  expect(before[1].assetId).toBe(before[2].assetId); expect(before[1].id).not.toBe(before[2].id);
  await dialog.locator('.audio-layer').last().getByRole('button', { name: 'Remove Voice.wav', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close audio layers', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await readProject(page)).audioLayers).toEqual(before);
  await saveAndReopen(page);
  const after = (await readProject(page)).audioLayers;
  expect(after.map((layer: any) => ({ ...layer, assetId: undefined }))).toEqual(before.map((layer: any) => ({ ...layer, assetId: undefined })));
  await page.getByRole('button', { name: 'Edit audio layers', exact: true }).click();
  await expect(dialog.locator('.audio-layer')).toHaveCount(3);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: `test-results/audio-layers-${width}.png` });
});

for (const width of [1440, 390]) test(`audio import keeps controls stable while loading and after failure at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page);
  await page.getByRole('button', { name: 'Edit audio layers', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Audio layers', exact: true });
  await dialog.getByLabel('Upload audio layers', { exact: true }).setInputFiles({ name: 'Music.wav', mimeType: 'audio/wav', buffer: wavFixture(3) });
  await expect(dialog.locator('.audio-layer')).toHaveCount(1);
  await page.evaluate(async () => {
    const { ProjectController } = await import('/src/features/project/ProjectController.ts' as string);
    const original = ProjectController.prototype.importAssets;
    ProjectController.prototype.importAssets = async function () {
      await new Promise<void>(resolve => { (window as any).releaseAudioImport = resolve; });
      ProjectController.prototype.importAssets = original;
      throw new Error('Audio test import failed');
    };
  });
  const before = await dialog.locator('.audio-layer').boundingBox();
  await dialog.getByLabel('Upload audio layers', { exact: true }).setInputFiles({ name: 'Second.wav', mimeType: 'audio/wav', buffer: wavFixture(2) });
  await expect(dialog.getByRole('group', { name: 'audio layers', exact: true })).toHaveAttribute('aria-busy', 'true');
  expect(await dialog.locator('.audio-layer').boundingBox()).toEqual(before);
  await page.evaluate(() => (window as any).releaseAudioImport());
  await expect(dialog.getByRole('status').filter({ hasText: 'Audio test import failed' })).toBeVisible();
  expect(await dialog.locator('.audio-layer').boundingBox()).toEqual(before);
});
