import { test, expect, openVideo, addBridge, readProject } from './fixtures';

for (const width of [1440, 390]) test(`timeline keyframes drag, delete, and undo inside the editor at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await openVideo(page); await addBridge(page);
  const open = () => page.getByRole('button', { name: 'Edit generation timeline', exact: true }).click();
  await open();
  const editor = page.getByRole('region', { name: 'Generation timeline', exact: true });
  await editor.getByRole('button', { name: 'Add image keyframe', exact: true }).click();
  await editor.getByLabel('Upload Keyframe image', { exact: true }).setInputFiles('src/app/tutorial/images/save.png');
  await expect(editor.getByRole('group', { name: 'Keyframe image', exact: true })).toHaveAttribute('aria-busy', 'false');
  const assetId = (await readProject(page)).interstitials[0].keyframes[0].image.assetId;
  await editor.getByLabel('Keyframe frame', { exact: true }).fill('63');
  const marker = editor.getByRole('button', { name: 'Select image keyframe 1', exact: true });
  await expect(marker).toHaveAttribute('title', /2\.625s/);
  // Dragging and undo run once, at full width; the narrow run checks the menu stays on screen.
  if (width === 1440) {
    await marker.hover();
    const lane = (await editor.locator('.generation-guides-lane').boundingBox())!, box = (await marker.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + lane.width * 24 / 226, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
    await expect(editor.getByLabel('Keyframe frame', { exact: true })).toHaveValue('87');
    await editor.getByRole('button', { name: 'Close generation timeline', exact: true }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await open();
  }
  await marker.click(); await expect(editor.getByLabel('Keyframe frame', { exact: true })).toHaveValue('63');
  await marker.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Image keyframe actions', exact: true });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(el => { const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight; })).toBe(true);
  if (width !== 1440) { await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); return; }
  await menu.getByRole('menuitem', { name: 'Disable keyframe', exact: true }).click();
  await expect(marker).toHaveAttribute('data-enabled', 'false');
  await marker.press('Shift+F10'); await expect(menu).toBeVisible(); await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0); await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Delete image keyframe', exact: true }).click();
  await expect(marker).toHaveCount(0);
  await editor.getByRole('button', { name: 'Close generation timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await readProject(page)).interstitials[0].keyframes[0]).toMatchObject({ enabled: false, image: { assetId } });
  await expect(page.getByRole('button', { name: 'Delete image keyframe', exact: true })).toHaveCount(0);
});

for (const loop of [false, true]) test(`legacy endpoint images remain removable${loop ? ' with linked loop endpoints' : ''}`, async ({ page }) => {
  await openVideo(page); await addBridge(page);
  if (loop) await page.getByRole('checkbox', { name: 'Loop', exact: true }).check();
  await page.getByRole('button', { name: 'Edit generation timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Add image keyframe', exact: true }).click();
  await page.getByLabel('Upload Keyframe image', { exact: true }).setInputFiles('src/app/tutorial/images/save.png');
  await expect(page.getByRole('group', { name: 'Keyframe image', exact: true })).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Close generation timeline', exact: true }).click();
  const { bytes, nodeId } = await page.evaluate(async () => {
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    const { packProject } = await import('/src/features/project/archive.ts' as string);
    const project = await readActiveProject(), item = project.interstitials[0], image = item.keyframes[0].image;
    Object.assign(item, { imageReferences: [image], keyframes: [], startReferenceType: 'image', endReferenceType: 'image', startImageIndex: 0, endImageIndex: 0, useInputReference: false, useOutputReference: false });
    const media = await Promise.all([project.source.assetId, image.assetId].map((id: string) => readAsset(id)));
    const archive = await packProject(project, media, new AbortController().signal, () => {});
    return { bytes: [...new Uint8Array(await archive.arrayBuffer())], nodeId: project.storyFlow.nodes.find((n: any) => n.interstitialId === item.id).id };
  });
  await page.getByLabel('Choose project file', { exact: true }).setInputFiles({ name: 'Endpoint images.sparko', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await page.locator(`[data-node-id="${nodeId}"] .story-clip-title`).click();
  await page.getByRole('button', { name: 'Edit generation timeline', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Generation timeline', exact: true });
  const start = editor.getByRole('button', { name: 'Start image guide: save.png', exact: true }), end = editor.getByRole('button', { name: 'End image guide: save.png', exact: true });
  await expect(start).toBeVisible(); await end.click();
  await editor.getByRole('button', { name: 'Remove image', exact: true }).click();
  await expect(end).toHaveCount(0); await expect(start).toHaveCount(loop ? 0 : 1);
  expect((await readProject(page)).interstitials[0].imageReferences).toHaveLength(1);
});
