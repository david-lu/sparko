import type { Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { writeClipMetadata } from '../../src/media/clipMetadata';
import { clipMetadata } from '../fixtures/clip-metadata';
import { test, expect, openVideo, readProject, dragIntoView, saveAndReopen, type Page } from './fixtures';

const asset = (page: Page, name: string) => page.getByRole('button', { name: `Library asset ${name}`, exact: true });
const selected = (page: Page) => page.locator('.library-media button[aria-pressed=true]');
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
async function importImages(page: Page, names: string[]) {
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 90;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#d88c50'; ctx.fillRect(0, 0, 160, 90);
    return c.toDataURL().split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Import assets', exact: true }).click();
  await (await chooser).setFiles(names.map(name => ({ name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
  await expect(asset(page, names.at(-1)!)).toBeVisible();
}
async function folder(page: Page, name: string) {
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder', exact: true });
  await dialog.getByLabel('Folder name').fill(name); await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
  return page.getByRole('button', { name: `Folder ${name}`, exact: true });
}
async function draft(page: Page) {
  await page.getByRole('button',{name:'Add image',exact:true}).press('Enter');
  return page.getByRole('button',{name:'Select Untitled image',exact:true});
}
async function fourthAsset(page:Page){await importImages(page,['Fourth.png']);return asset(page,'Fourth.png');}
async function beginDrag(page: Page, source: Locator, target: Locator) {
  await source.evaluate(el => el.scrollIntoView({ block: 'center' })); const from = (await source.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 3 });
  // Keep targets clear of the native drag autoscroll edge.
  await target.evaluate(el => el.scrollIntoView({ block: 'center' })); const to = (await target.boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2);
}
async function observeDragImage(page: Page) {
  await page.evaluate(() => {
    const original = DataTransfer.prototype.setDragImage;
    DataTransfer.prototype.setDragImage = function(image, x, y) {
      const r = image.getBoundingClientRect();
      (window as any).libraryDragImage = { text: image.textContent, width: r.width, height: r.height, images: image.querySelectorAll('img').length, effect: this.effectAllowed, x, y,
        thumbnails: [...image.querySelectorAll('.library-drag-thumbnail')].map(el => { const t = el.getBoundingClientRect(); return { x: t.x - r.x, y: t.y - r.y, width: t.width, height: t.height, alt: el.querySelector('img')?.alt }; }) };
      (window as any).libraryDragPreview = image.cloneNode(true);
      original.call(this, image, x, y);
    };
  });
}

for (const width of [1440, 390]) test(`library selections preview and move together with a read-only inspector at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const target = await folder(page, 'References'); await page.locator('.library-feedback').click();
  await importImages(page, ['One.png', 'Two.png', 'Three.png']); const generation = await fourthAsset(page);
  await asset(page, 'One.png').click(); await asset(page, 'Three.png').click({ modifiers: ['Shift'] });
  await expect(selected(page)).toHaveCount(3);
  await asset(page, 'Two.png').click({ modifiers: [modifier] }); await expect(selected(page)).toHaveCount(2);
  await asset(page, 'Two.png').click({ modifiers: [modifier] }); await generation.click({ modifiers: [modifier] });
  await expect(selected(page)).toHaveCount(4);
  const inspector = page.getByRole('region', { name: 'Selected assets', exact: true });
  await expect(inspector.getByRole('heading')).toHaveText('4 assets selected');
  await expect(inspector.locator('li')).toHaveCount(4);
  await expect(inspector).toContainText('One.png'); await expect(inspector).toContainText('Fourth.png');
  await expect(inspector.locator('input,textarea,select,button,[contenteditable=true]')).toHaveCount(0);
  await asset(page, 'One.png').scrollIntoViewIfNeeded();
  await expect(asset(page, 'One.png').locator('.library-thumb')).toHaveAttribute('data-preview-state', 'ready');
  await observeDragImage(page);
  const shape = () => page.locator('.asset-library').evaluate(el => ['.library-toolbar', '.library-filter', '.library-feedback', '.library-footer'].map(selector => {
    const r = el.querySelector(selector)!.getBoundingClientRect(), parent = el.getBoundingClientRect();
    return { top: r.top - parent.top, width: r.width, height: r.height };
  }));
  const before = await readProject(page), idle = await shape();
  await beginDrag(page, asset(page, 'One.png'), target); await expect(target).toHaveClass(/is-drop-target/);
  expect(await shape()).toEqual(idle);
  const preview = await page.evaluate(() => (window as any).libraryDragImage);
  expect(preview.text).toBe('4'); expect(preview.thumbnails).toHaveLength(4); expect(preview.effect).toBe('copyMove');
  expect(preview.x).toBe(preview.width / 2); expect(preview.y).toBe(preview.height / 2);
  expect(preview.thumbnails.map((t: any) => [t.x, t.y])).toEqual([[6, 6], [14, 14], [22, 22], [30, 30]]);
  await page.screenshot({ path: `test-results/library-multi-drag-${width}.png`, fullPage: true });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.is-drop-target,.asset-library.is-dropping')).toHaveCount(0);
  expect(await shape()).toEqual(idle); expect((await readProject(page)).library).toEqual(before.library);
  await beginDrag(page, asset(page, 'One.png'), target); await expect(target).toHaveClass(/is-drop-target/); await page.mouse.up();
  await expect(page.locator('.is-drop-target,.asset-library.is-dropping')).toHaveCount(0);
  const moved = await readProject(page), destination = moved.libraryFolders[0].id;
  expect(moved.library.filter((a: any) => a.name.endsWith('.png')).map((a: any) => a.folderId)).toEqual([destination, destination, destination, destination]);
  expect(moved.library.find((a:any)=>a.name==='Fourth.png').folderId).toBe(destination); expect(moved.storyFlow).toEqual(before.storyFlow);
  await expect(selected(page)).toHaveCount(4); expect((await shape()).slice(0, 2)).toEqual(idle.slice(0, 2));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await readProject(page)).library).toEqual(before.library); expect((await readProject(page)).clipGenerations).toEqual(before.clipGenerations);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await readProject(page)).library).toEqual(moved.library);
  // Moving back to the project root keeps the whole selection.
  await beginDrag(page, asset(page, 'One.png'), page.locator('.library-feedback'));
  await expect(page.locator('.asset-library')).toHaveClass(/is-dropping/); await page.mouse.up();
  expect((await readProject(page)).library.filter((a: any) => a.name.endsWith('.png')).every((a: any) => !a.folderId)).toBe(true);
  expect((await readProject(page)).library.find((a:any)=>a.name==='Fourth.png').folderId).toBeUndefined();
  await asset(page, 'One.png').click(); await expect(selected(page)).toHaveCount(1);
  await expect(page.getByLabel('Asset name', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(errors).toEqual([]);
});

test('folder drop targets track single drags, reject folder cycles, and clear on exit', async ({ page }) => {
  await openVideo(page); const parent = await folder(page, 'Parent'), child = await folder(page, 'Child');
  await page.locator('.library-feedback').click(); await importImages(page, ['Single.png']); await observeDragImage(page);
  const source = asset(page, 'Single.png'); await expect(source.locator('.library-thumb')).toHaveAttribute('data-preview-state', 'ready');
  await beginDrag(page, source, parent); await expect(parent).toHaveClass(/is-drop-target/);
  const preview = await page.evaluate(() => (window as any).libraryDragImage);
  expect(preview).toMatchObject({ images: 1, effect: 'copyMove', text: '' }); expect(preview.thumbnails).toHaveLength(1);
  expect(preview.x).toBe(preview.width / 2); expect(preview.y).toBe(preview.height / 2);
  const bounds = (await child.boundingBox())!;
  await page.mouse.move(bounds.x + 40, bounds.y + bounds.height / 2); await page.mouse.move(bounds.x + 41, bounds.y + bounds.height / 2);
  await expect(child).toHaveClass(/is-drop-target/); await expect(parent).not.toHaveClass(/is-drop-target/);
  await page.mouse.move(20, 20); await expect(page.locator('.is-drop-target')).toHaveCount(0);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await beginDrag(page, parent, child); await expect(child).not.toHaveClass(/is-drop-target/); await page.mouse.up();
  expect((await readProject(page)).libraryFolders.find((f: any) => f.name === 'Parent').parentId).toBeUndefined();
});

for (const width of [1440, 390]) test(`30 assets use four centered thumbnails and move from nested folders to the root background at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page);
  await folder(page, 'Parent'); const nested = await folder(page, 'Nested');
  const names = Array.from({ length: 30 }, (_, i) => `Image ${i + 1}.png`);
  await importImages(page, names);
  const before = await readProject(page), folderId = before.libraryFolders.find((f: any) => f.name === 'Nested').id;
  expect(before.library.filter((a: any) => a.folderId === folderId)).toHaveLength(30);
  await nested.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Select unused assets', exact: true }).click();
  await expect(selected(page)).toHaveCount(30);
  // The first four previews must be ready even when dragging a row far below them.
  await expect(page.locator('[data-library-drag-sources] .library-thumb[data-preview-state=ready]')).toHaveCount(4);
  await observeDragImage(page);
  const root = page.locator('.asset-library'), background = page.locator('.library-feedback');
  await beginDrag(page, asset(page, names[29]), background);
  await expect(root).toHaveClass(/is-dropping/); await expect(root).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Project assets', exact: true })).toHaveCount(0);
  expect(await root.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await expect(page.locator('.asset-library')).toHaveClass(/is-dropping/);
  const preview = await page.evaluate(() => (window as any).libraryDragImage);
  expect(preview.text).toBe('30'); expect(preview.images).toBe(4); expect(preview.thumbnails).toHaveLength(4);
  expect(preview.thumbnails.map((t: any) => t.alt)).toEqual(names.slice(0, 4).map(name => `Thumbnail of ${name}`));
  expect(preview.thumbnails.map((t: any) => [t.x, t.y])).toEqual([[6, 6], [14, 14], [22, 22], [30, 30]]);
  expect(preview.x).toBe(preview.width / 2); expect(preview.y).toBe(preview.height / 2);
  expect(preview.width).toBeLessThan(130); expect(preview.height).toBeLessThan(100);
  await page.screenshot({ path: `test-results/library-root-drop-${width}.png`, fullPage: true });
  await page.mouse.up(); await expect(root).not.toHaveClass(/is-dropping/);
  await expect(page.locator('.asset-library')).not.toHaveClass(/is-dropping/);
  const moved = await readProject(page);
  expect(moved.library.filter((a: any) => names.includes(a.name) && !a.folderId)).toHaveLength(30);
  expect(moved.storyFlow).toEqual(before.storyFlow); await expect(selected(page)).toHaveCount(30);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect((await readProject(page)).library).toEqual(before.library);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect((await readProject(page)).library).toEqual(moved.library);
  // Native drag bitmaps are outside screenshots; render the captured bitmap source for visual review.
  await page.evaluate(() => { const preview = (window as any).libraryDragPreview as HTMLElement; preview.id = 'captured-drag-preview'; preview.style.background = 'var(--panel)'; document.body.append(preview); });
  await page.locator('#captured-drag-preview').screenshot({ path: `test-results/library-thumbnail-stack-${width}.png` });
  await page.evaluate(() => document.getElementById('captured-drag-preview')!.remove());
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('Select unused assets includes subfolders and excludes clip generation references', async ({ page }) => {
  await openVideo(page); await importImages(page, ['Outside.png']);
  const parent = await folder(page, 'References'); await importImages(page, ['Used.png', 'Unused.png']);
  await draft(page);
  await dragIntoView(page, asset(page, 'Used.png'), page.getByRole('group', { name: 'Reference assets', exact: true }));
  await folder(page, 'Nested'); await importImages(page, ['Nested.png']);
  await parent.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Select unused assets', exact: true }).click();
  await expect(selected(page)).toHaveCount(2);
  for (const name of ['Unused.png', 'Nested.png']) await expect(asset(page, name)).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Used.png', 'Outside.png', 'interstitial-reference.mp4']) await expect(asset(page, name)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('region', { name: 'Selected assets' }).locator('li')).toHaveCount(2);
  await page.locator('.library-feedback').click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Select unused assets', exact: true }).click();
  await expect(selected(page)).toHaveCount(3); await expect(asset(page, 'Outside.png')).toHaveAttribute('aria-pressed', 'true');
});

test('Enter commits imported and generated asset names without submitting generation', async ({ page }) => {
  await openVideo(page); await importImages(page, ['Original.png']);
  const heading = page.getByLabel('Asset name', { exact: true });
  await heading.fill('  Renamed.png  '); await heading.press('Enter');
  await expect(asset(page, 'Renamed.png')).toBeVisible(); await expect(heading).not.toBeFocused();
  expect((await readProject(page)).library.some((a: any) => a.name === 'Renamed.png')).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(asset(page, 'Original.png')).toBeVisible();
  await draft(page); let requests = 0;
  await page.route('**/api/library-generations', route => { requests++; return route.abort(); });
  const clipName=page.getByLabel('Clip name',{exact:true});await clipName.fill('Concept image');await clipName.press('Enter');
  await expect(page.getByRole('button',{name:'Select Concept image',exact:true})).toBeVisible();
  expect((await readProject(page)).clipGenerations[0]).toMatchObject({ name: 'Concept image', phase: 'draft' }); expect(requests).toBe(0);
});

for (const width of [1440, 390]) test(`multi-selection menus preserve assets, move together and delete with one undo at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page);
  await folder(page, 'References'); await page.locator('.library-feedback').click();
  await importImages(page, ['One.png', 'Two.png', 'Outside.png']); const generation = await fourthAsset(page);
  const chooseBatch = async () => {
    await asset(page, 'One.png').click(); await asset(page, 'Two.png').click({ modifiers: [modifier] }); await generation.click({ modifiers: [modifier] });
    await expect(selected(page)).toHaveCount(3);
  };
  await chooseBatch(); const before = await readProject(page);
  await asset(page, 'One.png').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Selected asset actions', exact: true });
  await expect(menu).toBeVisible(); await expect(selected(page)).toHaveCount(3);
  await expect(menu.getByRole('menuitem', { name: /Rename/ })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Move to folder', exact: true }).click();
  await page.getByRole('menu', { name: 'Move selected assets', exact: true }).getByRole('menuitem', { name: 'References', exact: true }).click();
  const moved = await readProject(page), folderId = moved.libraryFolders[0].id;
  expect(moved.library.filter((a: any) => ['One.png', 'Two.png'].includes(a.name)).every((a: any) => a.folderId === folderId)).toBe(true);
  expect(moved.library.find((a:any)=>a.name==='Fourth.png').folderId).toBe(folderId); await expect(selected(page)).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await readProject(page)).library).toEqual(before.library); expect((await readProject(page)).clipGenerations).toEqual(before.clipGenerations);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await asset(page, 'Outside.png').click({ button: 'right' });
  await expect(selected(page)).toHaveCount(1); await expect(page.getByRole('menu', { name: 'Asset actions', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await chooseBatch(); await asset(page, 'One.png').focus(); await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible(); await expect(selected(page)).toHaveCount(3);
  await menu.screenshot({ path: `test-results/library-multi-menu-${width}.png` });
  await menu.getByRole('menuitem', { name: 'Delete selected assets…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete 3 assets?', exact: true });
  await expect(dialog.getByLabel('Assets to delete').locator('li')).toHaveCount(3);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(selected(page)).toHaveCount(3);
  await page.locator('.asset-library').press(width === 1440 ? 'Delete' : 'Backspace');
  await dialog.getByRole('button', { name: 'Delete assets', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(asset(page, 'One.png')).toHaveCount(0); await expect(asset(page, 'Two.png')).toHaveCount(0); await expect(generation).toHaveCount(0);
  await expect(asset(page, 'Outside.png')).toBeVisible();
  expect((await readProject(page)).storyFlow).toEqual(before.storyFlow);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await readProject(page)).library).toEqual(moved.library); expect((await readProject(page)).clipGenerations).toEqual(moved.clipGenerations);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(asset(page, 'One.png')).toHaveCount(0); await expect(generation).toHaveCount(0);
});

test('batch deletion omits dependencies contained entirely within the selection', async ({ page }) => {
  await openVideo(page); await importImages(page, ['Input.png', 'A.png', 'B.png']);
  const archive = await page.evaluate(async () => {
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    const { packProject } = await import('/src/features/project/archive.ts' as string);
    const { assetIds } = await import('/src/features/project/types.ts' as string);
    const { newAssetGeneration } = await import('/shared/asset-generation.ts' as string);
    const project = await readActiveProject(), input = project.library.find((a: any) => a.name === 'Input.png'), a = project.library.find((a: any) => a.name === 'A.png'), b = project.library.find((a: any) => a.name === 'B.png');
    [[a, input], [b, a]].forEach(([output, reference]) => {
      const generation = newAssetGeneration('image'); generation.name = output.name; generation.phase = 'ready';
      generation.settings.references = [{ assetId: reference.assetId, name: reference.name, kind: 'image' }];
      generation.submitted = structuredClone(generation.settings);
      generation.versions = [{ assetId: output.assetId, name: output.name, createdAt: 0, settings: structuredClone(generation.settings) }];
      output.generation = { provider: 'fal', createdAt: 0, settings: generation.settings };
    });
    const blob = await packProject(project, await Promise.all(assetIds(project).map(readAsset)), new AbortController().signal, () => {});
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.getByLabel('Choose project file', { exact: true }).setInputFiles({ name: 'Chain.sparko', mimeType: 'application/zip', buffer: Buffer.from(archive) });
  await expect.poll(async () => (await readProject(page)).library.filter((asset: any) => asset.generation).length).toBe(2);
  await asset(page, 'Input.png').click(); await asset(page, 'A.png').click({ modifiers: [modifier] }); await asset(page, 'B.png').click({ modifiers: [modifier] });
  await asset(page, 'B.png').press('Delete');
  const dialog = page.getByRole('dialog', { name: 'Delete 3 assets?', exact: true });
  await expect(dialog).not.toContainText('remaining uses');
  await dialog.getByRole('button', { name: 'Delete assets', exact: true }).click();
  await expect(asset(page, 'Input.png')).toHaveCount(0); await expect(asset(page, 'A.png')).toHaveCount(0); await expect(asset(page, 'B.png')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(asset(page, 'A.png')).toBeVisible();
  // Deleting only the input still reports the surviving generated media.
  await asset(page, 'Input.png').click(); await asset(page, 'Input.png').press('Delete');
  const single = page.getByRole('dialog', { name: 'Delete Input.png?', exact: true });
  await expect(single).toContainText('A.png');
  await single.getByRole('button', { name: 'Delete asset', exact: true }).click();
  await asset(page, 'A.png').click();
  await page.locator('.asset-inspector .inspector-output > summary').click();
  await page.locator('.asset-inspector .generated-output-details > summary').click();
  await page.getByRole('button', { name: 'Saved reference errors', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Saved reference errors', exact: true })).toContainText('Input.png');
});

test('deleted generated video stays missing after export without resuming its saved render', async ({ page }) => {
  const blob = await writeClipMetadata(new Blob([await readFile('tests/fixtures/interstitial-reference.mp4')], { type: 'video/mp4' }), clipMetadata, new AbortController().signal);
  await page.goto('/');
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles({ name: 'Generated.mp4', mimeType: 'video/mp4', buffer: Buffer.from(await blob.arrayBuffer()) });
  await expect(page.locator('.story-clip')).toHaveCount(1);
  await expect.poll(async () => (await readProject(page)).interstitials[0].phase).toBe('ready');
  const output = asset(page, 'Across the doorway');
  await output.click(); await output.press('Delete');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete asset', exact: true }).click();
  await expect(output).toHaveCount(0);
  await saveAndReopen(page);
  await expect(output).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Video unavailable: missing media', exact: true })).toBeVisible();
  const project = await readProject(page);
  expect(project.interstitials[0].phase).toBe('ready');
  expect(project.deletedAssetIds).toContain(project.interstitials[0].result.assetId);
  await page.getByRole('button', { name: 'Across the doorway errors', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Across the doorway errors', exact: true })).toContainText('deleted');
});

test('batch deletion permits used source media and restores it with undo', async ({ page }) => {
  await openVideo(page); await importImages(page, ['Unused.png']);
  const source = asset(page, 'interstitial-reference.mp4');
  await source.click(); await asset(page, 'Unused.png').click({ modifiers: [modifier] });
  await asset(page, 'Unused.png').press('Delete');
  const dialog = page.getByRole('dialog', { name: 'Delete 2 assets?', exact: true });
  await expect(dialog).toContainText('Timeline footage'); await expect(dialog.getByRole('button', { name: 'Delete assets', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Delete assets', exact: true }).click();
  await expect(source).toHaveCount(0); await expect(asset(page, 'Unused.png')).toHaveCount(0);
  await page.locator('.story-clip-title').click();
  await expect(page.getByRole('button', { name: 'Source video errors', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(source).toBeVisible(); await expect(asset(page, 'Unused.png')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Source video errors', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await saveAndReopen(page);
  await expect(source).toHaveCount(0); await expect(asset(page, 'Unused.png')).toHaveCount(0);
  await page.locator('.story-clip-title').click();
  await expect(page.getByRole('button', { name: 'Source video errors', exact: true })).toBeVisible();
});

for(const width of [1440,390])test(`clip deletion waits for generation cancellation and keeps assets at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  await page.route('**/api/status',async route=>{const response=await route.fetch(),body=await response.json();await route.fulfill({json:{...body,providers:{...body.providers,fal:true}}});});
  let release!:()=>void,fail=true,cancellations=0;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/library-generations',route=>route.fulfill({json:{requestId:'batch-request-123'}}));
  await page.route('**/api/library-generations/nano-banana-2/batch-request-123',async route=>{
    if(route.request().method()!=='DELETE')return route.fulfill({json:{phase:'queued',count:1}});
    cancellations++;await gate;return route.fulfill(fail?{status:500,json:{error:'Cancellation failed. Try again.'}}:{json:{cancelled:true}});
  });
  await openVideo(page);await importImages(page,['Kept.png']);await draft(page);
  await page.getByLabel('Generation prompt',{exact:true}).fill('A reference image');await page.getByRole('button',{name:'Generate image',exact:true}).click();
  await expect.poll(async()=>(await readProject(page)).clipGenerations[0].phase).toBe('queued');
  const remove=page.getByRole('button',{name:'Delete selected clips',exact:true});await remove.scrollIntoViewIfNeeded();const bounds=await remove.boundingBox();await remove.click();
  await expect.poll(()=>cancellations).toBe(1);expect(await remove.boundingBox()).toEqual(bounds);await expect(page.locator('.story-clip')).toHaveCount(2);
  release();await expect.poll(async()=>(await readProject(page)).clipGenerations[0].phase).toBe('error');await expect(page.locator('.story-clip')).toHaveCount(2);
  fail=false;await remove.click();await expect(page.locator('.story-clip')).toHaveCount(1);await expect(asset(page,'Kept.png')).toBeVisible();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(2);expect((await readProject(page)).clipGenerations[0].phase).toBe('cancelled');
});
