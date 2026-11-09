import { openGenerationTimeline, showImageReferences, test, expect, openVideo, addDraft, readProject, type Page } from './fixtures';

async function importImages(page: Page, count = 1) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#765c3e'; ctx.fillRect(0, 0, 160, 90);
    return canvas.toDataURL().split(',')[1];
  });
  await page.getByLabel('Import library assets', { exact: true }).setInputFiles(Array.from({ length: count }, (_, i) => ({ name: `Reference ${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
  await expect(page.getByRole('button', { name: `Library asset Reference ${count}.png`, exact: true })).toBeVisible();
}

const layout = (page: Page) => page.locator('.clip-generation-editor').evaluate(root => ['textarea', '.asset-input', 'button[type=submit]'].map(selector => {
  const box = root.querySelector(selector)!.getBoundingClientRect(); return { top: box.top - root.getBoundingClientRect().top, height: box.height };
}));
const pickerLayout = (page: Page) => page.locator('.library-asset-picker').evaluate(root => ['input', '.library-asset-picker-list', '.library-asset-picker-actions'].map(selector => {
  const box = root.querySelector(selector)!.getBoundingClientRect(); return { top: box.top - root.getBoundingClientRect().top, height: box.height };
}));

for (const width of [1440, 390]) test(`Library image picker supports search, keyboard, retry and stable loading at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page); await importImages(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Add image', exact: true }).press('Enter');
  await page.getByLabel('Generation model', { exact: true }).selectOption('nano-banana-pro');
  const input = page.getByRole('group', { name: 'Reference assets', exact: true });
  const choose = input.getByRole('button', { name: 'Choose Reference assets from Library', exact: true });
  const before = await layout(page);
  await choose.click();
  const dialog = page.getByRole('dialog', { name: 'Choose Reference assets from Library', exact: true });
  const search = dialog.getByRole('searchbox', { name: 'Search Library assets', exact: true });
  await expect(search).toBeFocused(); await expect(dialog.getByRole('button', { name: 'interstitial-reference.mp4', exact: true })).toHaveCount(0);
  await search.fill('not found'); await expect(dialog).toContainText('No matching assets.');
  await search.fill('reference'); await dialog.getByRole('button', { name: 'Reference 1.png', exact: true }).press('Space');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(choose).toBeFocused();
  expect((await readProject(page)).clipGenerations[0].settings.references).toEqual([]);
  await choose.press('Enter'); await dialog.getByRole('button', { name: 'Reference 1.png', exact: true }).click();
  const assetId = (await readProject(page)).library.find((asset: any) => asset.name === 'Reference 1.png').assetId;
  await page.evaluate(async id => {
    const { assets } = await import('/src/features/project/assets.ts' as string);
    const original = assets.open.bind(assets), gate = new Promise<void>(resolve => { (window as any).finishAsset = resolve; });
    assets.open = async (requested: string) => { if (requested === id) { await gate; throw new Error('This reference file is missing. Choose another asset.'); } return original(requested); };
    (window as any).restoreAsset = () => { assets.open = original; };
  }, assetId);
  const modalBefore = await pickerLayout(page);
  await dialog.getByRole('button', { name: 'Use selected', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Adding…', exact: true })).toBeDisabled();
  expect(await layout(page)).toEqual(before); expect(await pickerLayout(page)).toEqual(modalBefore);
  await page.evaluate(() => (window as any).finishAsset());
  await expect(dialog.getByRole('status')).toContainText('This reference file is missing');
  expect(await layout(page)).toEqual(before); expect(await pickerLayout(page)).toEqual(modalBefore);
  const box = (await page.locator('.library-asset-picker').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `test-results/asset-picker-${width}.png` });
  await page.evaluate(() => (window as any).restoreAsset());
  await dialog.getByRole('button', { name: 'Use selected', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(choose).toBeFocused();
  await expect(input).toContainText('Reference 1.png'); expect(await layout(page)).toEqual(before);
  expect((await readProject(page)).clipGenerations[0].settings.references).toEqual([{ assetId, kind: 'image', name: 'Reference 1.png' }]);
  await choose.click(); await expect(dialog.getByRole('button', { name: 'Reference 1.png', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input.locator('.asset-reference-chip')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Library picker selects a timeline video and replaces an image keyframe independently', async ({ page }) => {
  await openVideo(page); await importImages(page, 2); await addDraft(page);
  const editor = await openGenerationTimeline(page);
  await editor.getByRole('button', { name: 'Add video', exact: true }).click();
  await editor.getByRole('button', { name: 'Choose Timeline video from Library', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Choose Timeline video from Library', exact: true });
  await expect(dialog.getByRole('button', { name: 'Reference 1.png', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'interstitial-reference.mp4', exact: true }).click();
  await dialog.getByRole('button', { name: 'Use asset', exact: true }).click(); await expect(dialog).toHaveCount(0);
  const video = (await readProject(page)).interstitials[0].timelineVideos[0];
  await editor.getByRole('button', { name: 'Add image keyframe', exact: true }).click();
  const image = editor.getByRole('group', { name: 'Keyframe image', exact: true });
  for (const name of ['Reference 1.png', 'Reference 2.png']) {
    await image.getByRole('button', { name: 'Choose Keyframe image from Library', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Choose Keyframe image from Library', exact: true });
    await dialog.getByRole('button', { name, exact: true }).click();
    await dialog.getByRole('button', { name: 'Use asset', exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(image.locator('.asset-reference-chip')).toHaveCount(1); await expect(image).toContainText(name);
  }
  expect((await readProject(page)).interstitials[0].timelineVideos[0]).toEqual(video);
});

test('numbered H3 image references can be chosen from Library with their nine-image limit', async ({ page }) => {
  await openVideo(page); await importImages(page, 10); await addDraft(page); await showImageReferences(page);
  const choose = page.getByRole('button', { name: 'Choose image references from Library', exact: true });
  await choose.click(); const dialog = page.getByRole('dialog', { name: 'Choose image references from Library', exact: true });
  for (let i = 1; i <= 9; i++) await dialog.getByRole('button', { name: `Reference ${i}.png`, exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Reference 10.png', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Use selected', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.locator('.image-reference-list li')).toHaveCount(9); await expect(choose).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remove Picture 1', exact: true })).toBeFocused();
  expect((await readProject(page)).interstitials[0].imageReferences.map((ref: any) => ref.name)).toEqual(Array.from({ length: 9 }, (_, i) => `Reference ${i + 1}.png`));
  await page.locator('.image-reference-list').getByRole('button', { name: 'Preview Reference 1.png', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview Reference 1.png', exact: true });
  await expect(preview.getByRole('img', { name: 'Reference 1.png', exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Close preview', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('.image-reference-list li')).toHaveCount(0);
  await expect(choose).toBeEnabled();
});

for (const width of [1440, 390]) test(`Inspector chooses and replaces clip media while keeping image duration at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page); await importImages(page, 2);
  await page.getByRole('button', { name: 'Add image', exact: true }).press('Enter');
  const duration = page.getByLabel('Image duration', { exact: true }), choose = page.getByRole('button', { name: 'Choose clip asset', exact: true });
  await expect(duration).toHaveValue('1');
  const original = (await readProject(page)).storyFlow.nodes[0];
  const pick = async (name: string) => {
    await choose.click(); const picker = page.getByRole('dialog', { name: 'Choose clip asset from Library', exact: true });
    await picker.getByRole('button', { name, exact: true }).click(); await picker.getByRole('button', { name: 'Use asset', exact: true }).click();
    await expect(picker).toHaveCount(0); await expect(choose).toBeFocused();
  };
  await pick('Reference 1.png'); await expect(page.locator('.clip-media-asset')).toContainText('Reference 1.png'); await expect(duration).toHaveValue('1');
  const firstId = (await readProject(page)).storyFlow.nodes[1].source.assetId;
  await duration.fill('2.5'); await duration.press('Tab');
  await pick('Reference 2.png'); await expect(page.locator('.clip-media-asset')).toContainText('Reference 2.png'); await expect(duration).toHaveValue('2.5');
  expect((await readProject(page)).storyFlow.nodes[1].source).toMatchObject({ kind: 'image', inFrame: 0, outFrame: 60 });
  expect((await readProject(page)).storyFlow.nodes[0]).toEqual(original);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('.clip-media-asset')).toContainText('Reference 1.png');
  expect((await readProject(page)).storyFlow.nodes[1].source.assetId).toBe(firstId); await expect(duration).toHaveValue('2.5');
  await addDraft(page); await pick('interstitial-reference.mp4');
  await expect(page.locator('.clip-media-asset')).toContainText('interstitial-reference.mp4');
  expect((await readProject(page)).storyFlow.nodes[2].source.assetId).toBe(original.source.assetId);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('.clip-media-asset')).toContainText('Draft · no media yet');
});

for (const width of [1440, 390]) test(`reference previews play media, keep selection and preserve loading layout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page); await importImages(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Add image', exact: true }).press('Enter');
  const input = page.getByRole('group', { name: 'Reference assets', exact: true }), before = await layout(page);
  await input.getByRole('button', { name: 'Choose Reference assets from Library', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose Reference assets from Library', exact: true });
  const previewButton = picker.getByRole('button', { name: 'Preview Reference 1.png', exact: true });
  await previewButton.click(); let preview = page.getByRole('dialog', { name: 'Preview Reference 1.png', exact: true });
  await expect(preview.getByRole('img', { name: 'Reference 1.png', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(preview).toHaveCount(0); await expect(picker).toBeVisible(); await expect(previewButton).toBeFocused();
  await expect(picker.getByRole('button', { name: 'Reference 1.png', exact: true })).toHaveAttribute('aria-pressed', 'false');
  for (const name of ['Reference 1.png', 'interstitial-reference.mp4']) await picker.getByRole('button', { name, exact: true }).click();
  await picker.getByRole('button', { name: 'Use selected', exact: true }).click(); await expect(picker).toHaveCount(0);
  const project = await readProject(page), id = project.library.find((asset: any) => asset.name === 'Reference 1.png').assetId;
  await page.evaluate(async id => {
    const { assets } = await import('/src/features/project/assets.ts' as string), original = assets.open.bind(assets);
    const gate = new Promise<void>(resolve => { (window as any).finishPreview = resolve; });
    assets.open = async (requested: string) => { if (requested === id) { await gate; if ((window as any).failPreview) throw new Error('This reference image is missing. Replace the reference or undo its deletion.'); } return original(requested); };
    (window as any).restorePreview = () => { assets.open = original; };
  }, id);
  const imageButton = input.getByRole('button', { name: 'Preview Reference 1.png', exact: true });
  await imageButton.click(); preview = page.getByRole('dialog', { name: 'Preview Reference 1.png', exact: true });
  await expect(preview.getByRole('status')).toContainText('Loading preview');
  const bounds = await preview.locator('.asset-preview-dialog').boundingBox(); expect(await layout(page)).toEqual(before);
  await page.evaluate(() => (window as any).finishPreview());
  await expect(preview.getByRole('img', { name: 'Reference 1.png', exact: true })).toBeVisible();
  expect(await preview.locator('.asset-preview-dialog').boundingBox()).toEqual(bounds); expect(await layout(page)).toEqual(before);
  await page.screenshot({ path: `test-results/reference-preview-${width}.png` });
  await preview.getByRole('button', { name: 'Close preview', exact: true }).click(); await expect(imageButton).toBeFocused();
  await page.evaluate(() => { (window as any).failPreview = true; }); await imageButton.click();
  await expect(preview.getByRole('status')).toContainText('This reference image is missing');
  expect(await preview.locator('.asset-preview-dialog').boundingBox()).toEqual(bounds); expect(await layout(page)).toEqual(before);
  await page.keyboard.press('Escape'); await page.evaluate(() => (window as any).restorePreview());
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  const videoButton = input.getByRole('button', { name: 'Preview interstitial-reference.mp4', exact: true }); await videoButton.click();
  const videoPreview = page.getByRole('dialog', { name: 'Preview interstitial-reference.mp4', exact: true }), video = videoPreview.locator('video');
  await expect(video).toHaveJSProperty('controls', true);
  await video.evaluate(async (media: HTMLVideoElement) => { (window as any).referencePreviewMedia = media; await media.play(); });
  await expect.poll(() => video.evaluate((media: HTMLVideoElement) => media.currentTime)).toBeGreaterThan(0);
  await expect(page.locator('.transport button[aria-label="Play"]')).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(videoPreview).toHaveCount(0); await expect(videoButton).toBeFocused();
  expect(await page.evaluate(() => (window as any).referencePreviewMedia.paused)).toBe(true);
  expect(await readProject(page)).toEqual(project); expect(errors).toEqual([]);
});
