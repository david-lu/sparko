import { readFile } from 'node:fs/promises';
import { openGenerationTimeline, closeGenerationTimeline, showImageReferences, test, expect, openVideo, dragIntoView, addDraft, readProject, saveAndReopen, type Page } from './fixtures';

async function create(page: Page, kind: 'Image' | 'Audio') {
  await page.getByRole('button',{name:`Add ${kind.toLowerCase()}`,exact:true}).press('Enter');
  await expect(page.getByLabel('Generation model', { exact: true })).toBeVisible();
}
async function falStatus(page: Page) {
  await page.route('**/api/status', async route => { const response = await route.fetch(), body = await response.json(); await route.fulfill({ json: { ...body, providers: { ...body.providers, fal: true } } }); });
}
async function importImage(page: Page) {
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d')!, gradient = ctx.createLinearGradient(0, 0, 640, 360);
    gradient.addColorStop(0, '#1c354b'); gradient.addColorStop(1, '#cf8354'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#edd2a2'; ctx.beginPath(); ctx.arc(440, 145, 45, 0, Math.PI * 2); ctx.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await page.getByLabel('Import library assets', { exact: true }).setInputFiles({ name: 'Character.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('button', { name: 'Library asset Character.png', exact: true })).toBeVisible();
  return png;
}

test('deleting referenced media shows missing inputs, supports undo and survives project export', async ({ page }) => {
  await openVideo(page); await importImage(page);
  const asset = page.getByRole('button', { name: 'Library asset Character.png', exact: true });
  await expect(page.getByLabel('Asset name', { exact: true })).toHaveValue('Character.png');
  await page.locator('.library-feedback').click();
  await expect(asset).toHaveAttribute('aria-pressed', 'false'); await expect(page.getByLabel('Asset name', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Library menu', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Library actions', exact: true })).toBeVisible();
  await page.getByText('Window', { exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Library actions', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await addDraft(page, 'Character scene');
  await showImageReferences(page);
  await dragIntoView(page, asset, page.getByRole('group', { name: 'Image references', exact: true }));
  await expect(page.getByRole('button', { name: 'Remove Picture 1', exact: true })).toBeVisible();
  await asset.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Delete asset…', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Character scene'); await expect(dialog).toContainText('image input');
  await expect(dialog.getByRole('button', { name: 'Delete asset', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Delete asset', exact: true }).click();
  await expect(asset).toHaveCount(0); await expect(page.locator('.story-clip')).toHaveCount(2);
  await closeGenerationTimeline(page);await page.locator('.story-clip.type-simple .story-clip-title').click();await showImageReferences(page);
  await page.getByRole('button', { name: 'Picture 1 errors', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Picture 1 errors', exact: true })).toContainText('Character.png');
  await expect(page.getByRole('dialog', { name: 'Picture 1 errors', exact: true })).toContainText('deleted');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(asset).toBeVisible();
  await expect(page.getByRole('button', { name: 'Picture 1 errors', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(asset).toHaveCount(0);
  await closeGenerationTimeline(page);await saveAndReopen(page);
  await expect(asset).toHaveCount(0);
  await page.locator('.story-clip.type-simple .story-clip-title').click();
  await showImageReferences(page);
  await expect(page.getByRole('button', { name: 'Picture 1 errors', exact: true })).toBeVisible();
});

for (const width of [1440, 390]) test(`deleted image inputs report their names without moving generation controls at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await falStatus(page); await openVideo(page); await importImage(page); await create(page, 'Image');
  const asset = page.getByRole('button', { name: 'Library asset Character.png', exact: true });
  await page.getByLabel('Generation prompt', { exact: true }).fill('A warm portrait');
  await dragIntoView(page, asset, page.getByRole('group', { name: 'Reference assets', exact: true }));
  const positions = () => page.locator('.clip-generation-editor').evaluate(el => {
    const top = el.getBoundingClientRect().top;
    return ['textarea', 'button[type=submit]', '.asset-generation-feedback'].map(selector => {
      const r = el.querySelector(selector)!.getBoundingClientRect(); return { top: r.top - top, height: r.height };
    });
  });
  const before = await positions();
  await asset.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Delete asset…', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete asset', exact: true }).click();
  await page.getByRole('button', { name: 'Select Untitled image', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Generate image', exact: true })).toBeDisabled();
  expect(await positions()).toEqual(before);
  await page.getByRole('button', { name: 'Generation errors', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Generation errors', exact: true })).toContainText('Character.png');
  await expect(page.getByRole('dialog', { name: 'Generation errors', exact: true })).toContainText('deleted');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate image', exact: true })).toBeEnabled();
  expect(await positions()).toEqual(before);
});

for (const width of [1440, 390]) test(`image generation keeps Inspector controls stable at ${width}px and saves its submitted inputs`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await falStatus(page); let complete = false, submitted: any, png: Buffer;
  await page.route('**/api/library-generations', async route => { submitted = route.request().postDataJSON(); await route.fulfill({ json: { requestId: 'request_123' } }); });
  await page.route('**/api/library-generations/nano-banana-2/request_123', route => route.fulfill({ json: { phase: complete ? 'ready' : 'rendering', count: 1 } }));
  await page.route('**/api/library-generations/nano-banana-2/request_123/content/0', route => route.fulfill({ contentType: 'image/png', body: png }));
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page); png = await importImage(page); await create(page, 'Image');
  await page.getByLabel('Generation prompt', { exact: true }).fill('Turn the reference into a warm film poster');
  await dragIntoView(page, page.getByRole('button', { name: 'Library asset Character.png', exact: true }), page.getByRole('group', { name: 'Reference assets', exact: true }));
  await expect(page.getByRole('button', { name: 'Remove reference Character.png', exact: true })).toBeVisible();
  const positions = () => page.locator('.clip-inspector').evaluate(el => { const root = el.getBoundingClientRect(); return ['.inspector-output', 'textarea', 'button[type=submit]', '.asset-generation-feedback'].map(s => { const r = el.querySelector(s)!.getBoundingClientRect(); return { y: Math.round(r.top - root.top), height: r.height }; }); });
  const before = await positions();
  await page.getByRole('button', { name: 'Generate image', exact: true }).click();
  await expect(page.getByRole('button',{name:'Generating…',exact:true})).toBeDisabled();
  expect(await positions()).toEqual(before);
  await page.getByLabel('Generation prompt', { exact: true }).fill('A different future version');
  expect(submitted.settings.prompt).toBe('Turn the reference into a warm film poster'); expect(submitted.inputs[0].kind).toBe('image');
  await page.screenshot({ path: `test-results/image-generation-${width}-loading.png`, fullPage: true });
  complete = true;
  await expect(page.locator('.story-clip.selected .video-filmstrip img')).toBeVisible({ timeout: 15_000 });
  expect(await positions()).toEqual(before);
  await expect.poll(async () => (await readProject(page)).clipGenerations[0].versions.length).toBe(1);
  const generation = (await readProject(page)).clipGenerations[0];
  expect(generation.versions[0].settings.prompt).toBe('Turn the reference into a warm film poster'); expect(generation.settings.prompt).toBe('A different future version');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `test-results/image-generation-${width}-ready.png`, fullPage: true });
  if (width === 1440) {
    await page.getByRole('button', { name: 'Collapse Library panel', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse Add clips panel', exact: true }).click();
    await page.getByLabel('Clip name', { exact: true }).scrollIntoViewIfNeeded();
    await page.locator('.sidebar').screenshot({ path: 'test-results/image-generation-ui.png' });
    await saveAndReopen(page);
    await page.getByRole('button', { name: 'Expand Library panel', exact: true }).click();
    await page.getByRole('button', { name: 'Select Untitled image', exact: true }).click();
    await expect(page.locator('.story-clip.selected .video-filmstrip img')).toBeVisible();
    expect((await readProject(page)).clipGenerations[0].versions).toHaveLength(1);
  }
  expect(errors).toEqual([]);
});

test('a cancelled generation can retrieve its result without another paid submission', async ({ page }) => {
  await falStatus(page); await openVideo(page); const png = await importImage(page);
  let complete = false, submitted = 0, cancelled = 0;
  await page.route('**/api/library-generations', route => { submitted++; return route.fulfill({ json: { requestId: 'request_123' } }); });
  await page.route('**/api/library-generations/nano-banana-2/request_123', route => {
    if (route.request().method() === 'DELETE') { cancelled++; return route.fulfill({ json: { cancelled: true } }); }
    return route.fulfill({ json: { phase: complete ? 'ready' : 'queued', count: 1 } });
  });
  await page.route('**/api/library-generations/nano-banana-2/request_123/content/0', route => route.fulfill({ contentType: 'image/png', body: png }));
  await create(page, 'Image'); await page.getByLabel('Generation prompt', { exact: true }).fill('A poster');
  await page.getByRole('button', { name: 'Generate image', exact: true }).click();
  await expect.poll(() => submitted).toBe(1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect.poll(() => cancelled).toBe(1);
  complete = true; await page.getByRole('button', { name: 'Check result', exact: true }).click();
  await expect(page.locator('.story-clip.selected .video-filmstrip img')).toBeVisible(); expect(submitted).toBe(1);
});

test('folders import media without creating timeline clips and Start/End video toggles stay independent', async ({ page }) => {
  await openVideo(page);
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await page.getByRole('dialog', { name: 'New folder', exact: true }).getByLabel('Folder name').fill('References');
  await page.getByRole('dialog', { name: 'New folder', exact: true }).getByRole('button', { name: 'Create folder', exact: true }).click();
  const buffer = await readFile('tests/fixtures/interstitial-reference.mp4');
  const transfer = await page.evaluateHandle(bytes => { const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(bytes)], 'Arbitrary.mp4', { type: 'video/mp4' })); return data; }, [...buffer]);
  await page.getByRole('button', { name: 'Folder References', exact: true }).dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.getByRole('button', { name: 'Library asset Arbitrary.mp4', exact: true })).toBeVisible();
  await expect(page.locator('.story-clip')).toHaveCount(1);
  const project = await readProject(page); expect(project.library.find((a: any) => a.name === 'Arbitrary.mp4').folderId).toBe(project.libraryFolders[0].id);
  await addDraft(page);
  const editor = await openGenerationTimeline(page);
  await editor.getByRole('checkbox', { name: 'Reference start video', exact: true }).check();
  await editor.getByRole('checkbox', { name: 'Reference end video', exact: true }).check();
  await editor.getByRole('button', { name: 'Add video', exact: true }).click();
  await dragIntoView(page, page.getByRole('button', { name: 'Library asset Arbitrary.mp4', exact: true }), editor.getByRole('group', { name: 'Timeline video', exact: true }));
  await expect(editor.getByRole('group', { name: 'Timeline video', exact: true })).toContainText('Arbitrary.mp4');
  const video = (await readProject(page)).interstitials[0].timelineVideos[0];
  await editor.getByRole('checkbox', { name: 'Reference start video', exact: true }).uncheck();
  await expect(editor.getByRole('checkbox', { name: 'Reference end video', exact: true })).toBeChecked();
  const item = (await readProject(page)).interstitials[0];
  expect(item.timelineVideos[0]).toEqual(video); expect(item.useInputReference).toBe(false); expect(item.useOutputReference).toBe(true);

});

test('audio generation saves a playable output and exposes the supported audio models', async ({ page }) => {
  await falStatus(page); await openVideo(page);
  await page.route('**/api/library-generations', route => route.fulfill({ json: { requestId: 'request_123' } }));
  await page.route('**/api/library-generations/*/request_123', route => route.fulfill({ json: { phase: 'ready', count: 1 } }));
  await page.route('**/api/library-generations/stable-audio-2.5/request_123/content/0', route => route.fulfill({ contentType: 'audio/wav', path: 'tests/fixtures/voice-answer.wav' }));
  await create(page, 'Audio'); await page.getByLabel('Generation model', { exact: true }).selectOption('stable-audio-2.5');
  await page.getByLabel('Generation prompt', { exact: true }).fill('Gentle ambient music');
  await page.getByLabel('Generation duration', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'Generate audio', exact: true }).click();
  await expect(page.locator('.story-clip.selected [aria-label="Audio clip"]')).toBeVisible();
  await expect.poll(async () => (await readProject(page)).clipGenerations.filter((g: any) => g.phase === 'ready').length).toBe(1);
});

test('all panels can float, dock, maximize, and reset without changing the default workspace', async ({ page }) => {
  await openVideo(page); await page.getByText('Window', { exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Arrange all panels', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Player', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Float Timeline panel', exact: true }).click();
  await expect(page.locator('.dock-floating .story-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Move floating Timeline panel', exact: true }).press('ArrowRight');
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('sparko:free-panel-layout')))! ).floating[0].x).toBe(60);
  await page.getByRole('button', { name: 'Dock Timeline panel', exact: true }).click(); await expect(page.locator('.dock-floating')).toHaveCount(0);
  await page.getByRole('button', { name: 'Maximize Player panel', exact: true }).click(); await expect(page.locator('.dock-group-maximized')).toHaveCount(1);
  await expect(page.locator('.video-stage')).toHaveCount(1); await page.keyboard.press('Escape'); await expect(page.locator('.dock-group-maximized')).toHaveCount(0);
  await page.getByText('Window', { exact: true }).click(); await page.getByRole('menuitem', { name: 'Reset workspace', exact: true }).click();
  await expect(page.locator('.dock-workspace')).toHaveCount(0); await expect(page.locator('.story-canvas')).toHaveCount(1);
});
