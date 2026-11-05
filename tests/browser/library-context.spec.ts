import { test, expect, openVideo, readProject, saveAndReopen, type Page } from './fixtures';

async function picture(page: Page, name = 'Reference.png') {
  const data = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 160; c.height = 90; const ctx = c.getContext('2d')!; ctx.fillStyle = '#4b98ad'; ctx.fillRect(0, 0, 160, 90); ctx.fillStyle = '#ffe1a4'; ctx.fillRect(30, 20, 70, 40); return c.toDataURL().split(',')[1]; });
  return { name, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
}
const actions = (page: Page) => page.locator('.library-context-menu');
const asset = (page: Page, name: string) => page.getByRole('button', { name: `Library asset ${name}`, exact: true });

for (const width of [1440, 390]) test(`asset thumbnails and context menus work without shifting rows at ${width}px`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page);
  const video = asset(page, 'interstitial-reference.mp4');
  await expect(video.locator('.library-thumb')).toHaveAttribute('data-preview-state', 'ready');
  await expect(video.getByRole('img', { name: 'Thumbnail of interstitial-reference.mp4' })).toBeVisible();
  await page.evaluate(() => {
    const original = window.createImageBitmap, gate = new Promise<void>(resolve => { (window as any).releaseThumbnail = resolve; });
    window.createImageBitmap = (async (...args: any[]) => { if (args[1]?.resizeWidth) await gate; return (original as any)(...args); }) as typeof original;
  });
  await page.getByLabel('Import library assets', { exact: true }).setInputFiles(await picture(page));
  const image = asset(page, 'Reference.png'); await image.scrollIntoViewIfNeeded();
  await expect(image.locator('.library-thumb')).toHaveAttribute('data-preview-state', 'loading');
  const dimensions = () => image.evaluate(el => { const r = el.getBoundingClientRect(), t = el.querySelector('.library-thumb')!.getBoundingClientRect(); return { width: r.width, height: r.height, thumbWidth: t.width, thumbHeight: t.height, textY: el.querySelector('strong')!.getBoundingClientRect().top - r.top }; });
  const before = await dimensions(); await page.evaluate(() => (window as any).releaseThumbnail());
  await expect(image.locator('.library-thumb')).toHaveAttribute('data-preview-state', 'ready'); expect(await dimensions()).toEqual(before);
  await page.evaluate(() => { const original = window.createImageBitmap; window.createImageBitmap = ((...args: any[]) => args[1]?.resizeWidth ? Promise.reject(new Error('Test thumbnail failure')) : (original as any)(...args)) as typeof original; });
  await page.getByLabel('Import library assets', { exact: true }).setInputFiles(await picture(page, 'Unavailable.png'));
  const unavailable = asset(page, 'Unavailable.png'); await unavailable.scrollIntoViewIfNeeded();
  await expect(unavailable.locator('.library-thumb')).toHaveAttribute('data-preview-state', 'unavailable');
  expect(await unavailable.locator('.library-thumb').evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }))).toEqual({ width: before.thumbWidth, height: before.thumbHeight });
  await page.getByLabel('Import library assets', { exact: true }).setInputFiles('tests/fixtures/voice-answer.wav');
  const audio = asset(page, 'voice-answer.wav'); await audio.scrollIntoViewIfNeeded();
  await expect(audio.locator('.library-thumb')).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
  await expect(audio.getByRole('img', { name: 'Waveform of voice-answer.wav' })).toBeVisible();

  await audio.click(); await image.click({ button: 'right' });
  await expect(actions(page).getByRole('menuitem').allTextContents()).resolves.toEqual(['Open in Inspector', 'Add to timeline', 'Download', 'Rename asset…', 'Delete asset…']);
  await expect(image).toHaveAttribute('aria-pressed', 'true'); await expect(audio).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByLabel('Asset name', { exact: true })).toHaveValue('Reference.png');
  await page.keyboard.press('Escape'); await expect(image).toBeFocused();
  await image.press('Shift+F10'); await expect(actions(page)).toHaveAttribute('aria-label', 'Asset actions');
  await page.keyboard.press('End'); await expect(actions(page).getByRole('menuitem', { name: 'Delete asset…', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');

  await video.click({ button: 'right' });
  await expect(actions(page).getByRole('menuitem', { name: 'Add to timeline', exact: true })).toBeVisible();
  await expect(actions(page).getByRole('menuitem', { name: 'Create generation', exact: true })).toHaveCount(0);
  await expect(actions(page).getByRole('menuitem', { name: 'Edit image', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape'); await audio.click({ button: 'right' });
  expect(await actions(page).getByRole('menuitem').allTextContents()).toEqual(['Open in Inspector', 'Add to timeline', 'Download', 'Rename asset…', 'Delete asset…']);
  const box = await actions(page).boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width); expect(box!.y + box!.height).toBeLessThanOrEqual(1000);
  await page.screenshot({ path: `test-results/library-context-${width}.png`, fullPage: true });
  await page.keyboard.press('Escape'); await image.click();
  await page.locator('.library-feedback').click({ button: 'right' });
  expect((await actions(page).getByRole('menuitem').allTextContents()).map(text => text.trim())).toEqual(['Import files…', 'Import folder…', 'New folder', 'Select unused assets']);
  await expect(image).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape'); await page.getByLabel('Search library').click({ button: 'right' }); await expect(actions(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('subtitles stay outside the asset library while project subtitle tracks still work', async ({ page }) => {
  await openVideo(page);
  const captions = { name: 'Captions.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n') };
  await page.getByLabel('Import library assets', { exact: true }).setInputFiles(captions);
  await expect(page.locator('.library-feedback').first()).toContainText('Choose image, video, or audio files.');
  await expect(asset(page, 'Captions.vtt')).toHaveCount(0);
  expect(await page.getByLabel('Library category').locator('option').allTextContents()).toEqual(['All assets', 'Images', 'Videos', 'Audio']);
  await page.getByLabel('Choose subtitle file', { exact: true }).setInputFiles(captions);
  await expect.poll(async () => (await readProject(page)).subtitle?.name).toBe('Captions.vtt');
  await expect(asset(page, 'Captions.vtt')).toHaveCount(0);
  expect((await readProject(page)).library.some((a: any) => a.kind === 'subtitle')).toBe(false);
  await saveAndReopen(page);
  await expect(asset(page, 'interstitial-reference.mp4')).toBeVisible();
  await expect(asset(page, 'Captions.vtt')).toHaveCount(0);
  expect((await readProject(page)).subtitle.name).toBe('Captions.vtt');
});

test('asset actions operate on the clicked asset and folders preserve their contents when removed', async ({ page }) => {
  await openVideo(page); await page.getByLabel('Import library assets', { exact: true }).setInputFiles(await picture(page));
  await asset(page, 'Reference.png').click({ button: 'right' });
  page.once('dialog', d => d.accept('Renamed.png')); await actions(page).getByRole('menuitem', { name: 'Rename asset…', exact: true }).click();
  await expect(page.getByLabel('Asset name', { exact: true })).toHaveValue('Renamed.png');
  await asset(page, 'Renamed.png').click({ button: 'right' });
  const downloaded = page.waitForEvent('download'); await actions(page).getByRole('menuitem', { name: 'Download', exact: true }).click(); expect((await downloaded).suggestedFilename()).toBe('Renamed.png');
  await asset(page, 'Renamed.png').click({ button: 'right' }); await actions(page).getByRole('menuitem', { name: 'Add to timeline', exact: true }).click();
  await page.getByRole('button',{name:'Generate a new version',exact:true}).click();
  await expect(page.getByLabel('Generation prompt', { exact: true })).toBeVisible();
  expect((await readProject(page)).clipGenerations[0].settings.references[0].name).toBe('Renamed.png');
  const nativeDialogs: string[] = [];
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: 'New folder', exact: true });
  await expect(createDialog.getByLabel('Folder name')).toBeFocused();
  await createDialog.getByLabel('Folder name').fill('   ');
  await expect(createDialog.getByRole('button', { name: 'Create folder', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(createDialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New folder', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await createDialog.getByLabel('Folder name').fill('References');
  await createDialog.getByLabel('Folder name').press('Enter');
  const folder = page.getByRole('button', { name: 'Folder References', exact: true }); await folder.click({ button: 'right' });
  await expect(actions(page)).toHaveAttribute('aria-label', 'Folder actions');
  await expect(actions(page).getByRole('menuitem', { name: 'Delete asset…', exact: true })).toHaveCount(0);
  await expect(actions(page).getByRole('menuitem', { name: 'Create generation', exact: true })).toHaveCount(0);
  const chooser = page.waitForEvent('filechooser'); await actions(page).getByRole('menuitem', { name: 'Import files here…', exact: true }).click();
  await (await chooser).setFiles(await picture(page, 'Inside.png'));
  await expect(asset(page, 'Inside.png')).toBeVisible();
  const before = await readProject(page), id = before.libraryFolders[0].id;
  expect(before.library.find((a: any) => a.name === 'Inside.png').folderId).toBe(id);
  await folder.click({ button: 'right' }); await actions(page).getByRole('menuitem', { name: 'Remove folder (keep assets)', exact: true }).click();
  await expect(folder).toHaveCount(0); await expect(asset(page, 'Inside.png')).toBeVisible();
  expect((await readProject(page)).library.find((a: any) => a.name === 'Inside.png').folderId).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(folder).toBeVisible();
  expect((await readProject(page)).library.find((a: any) => a.name === 'Inside.png').folderId).toBe(id);
  await page.setViewportSize({ width: 390, height: 844 });
  await folder.click({ button: 'right' }); await actions(page).getByRole('menuitem', { name: 'Rename folder…', exact: true }).click();
  const renameDialog = page.getByRole('dialog', { name: 'Rename folder', exact: true });
  await expect(renameDialog.getByLabel('Folder name')).toHaveValue('References');
  await renameDialog.getByLabel('Folder name').fill('Reference media');
  const bounds = await renameDialog.locator('form').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/library-folder-dialog-390.png' });
  await renameDialog.getByRole('button', { name: 'Save name', exact: true }).click();
  const renamed = page.getByRole('button', { name: 'Folder Reference media', exact: true }); await expect(renamed).toBeFocused();
  await renamed.click({ button: 'right' }); await actions(page).getByRole('menuitem', { name: 'New subfolder', exact: true }).click();
  await createDialog.getByLabel('Folder name').fill('Nested'); await createDialog.getByRole('button', { name: 'Create folder', exact: true }).click();
  expect((await readProject(page)).libraryFolders.find((f: any) => f.name === 'Nested').parentId).toBe(id);
  expect(nativeDialogs).toEqual([]);
});

test('generation controls stay on the clip while the Library exposes completed media', async ({ page }) => {
  await page.route('**/api/status',async route=>{const response=await route.fetch(),body=await response.json();await route.fulfill({json:{...body,providers:{...body.providers,fal:true}}});});
  await openVideo(page);const png=await picture(page);let complete=false,cancelled=0;
  await page.route('**/api/library-generations',route=>route.fulfill({json:{requestId:'request_123'}}));
  await page.route('**/api/library-generations/nano-banana-2/request_123',route=>{if(route.request().method()==='DELETE'){cancelled++;return route.fulfill({json:{cancelled:true}});}return route.fulfill({json:{phase:complete?'ready':'queued',count:1}});});
  await page.route('**/api/library-generations/nano-banana-2/request_123/content/0',route=>route.fulfill({body:png.buffer,contentType:'image/png'}));
  await page.getByRole('button',{name:'Add image',exact:true}).press('Enter');
  await expect(page.locator('[data-library-type=generation]')).toHaveCount(0);
  await page.getByLabel('Generation prompt',{exact:true}).fill('A reference image');await page.getByRole('button',{name:'Generate image',exact:true}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect.poll(()=>cancelled).toBe(1);
  complete=true;await page.getByRole('button',{name:'Check result',exact:true}).click();
  const output=asset(page,'Untitled image · v1');await expect(output).toBeVisible();await output.click({button:'right'});
  expect(await actions(page).getByRole('menuitem').allTextContents()).toEqual(['Open in Inspector','Add to timeline','Download','Rename asset…','Delete asset…']);
});
