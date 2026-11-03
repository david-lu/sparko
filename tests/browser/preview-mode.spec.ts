import { test, expect, openVideo, addBridge, addQuestionTemplate, readProject, type Page } from './fixtures';

const preview = (page: Page) => page.getByRole('button', { name: 'Preview', exact: true });
const edit = (page: Page) => page.getByRole('button', { name: 'Edit', exact: true });
const seek = (page: Page) => page.getByRole('slider', { name: 'Seek video', exact: true });
const geometry = (page: Page) => page.locator('.menubar,.video-stage,.transport,.preview-seek').evaluateAll(elements => elements.map(el => {
  const { x, y, width, height } = el.getBoundingClientRect(); return { x, y, width, height };
}));

test('preview is read-only, preserves the workspace, and seeks through colored interstitials', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openVideo(page); await addBridge(page);
  await page.getByLabel('Clip name', { exact: true }).fill('Preview scene');
  await page.getByLabel('Interstitial prompt').fill('Keep this prompt');
  await page.getByLabel('Interstitial prompt').press('Tab');
  const before = await readProject(page);
  const camera = await page.locator('.story-scroll').getAttribute('style');
  await preview(page).click();
  await expect(preview(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.story-canvas')).toBeHidden();
  await expect(page.getByRole('complementary', { name: 'Workspace panels' })).toBeHidden();
  await expect(page.getByRole('group', { name: 'Edit history' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load captions' })).toHaveCount(0);
  await expect(page.getByLabel('Choose video file', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Choose subtitle file', { exact: true })).toBeDisabled();
  await expect(page.locator('.preview-marker.scene')).toHaveCount(1);
  await seek(page).fill('3');
  await expect(seek(page)).toHaveValue('3');
  await expect(page.locator('.preview-chapter')).toContainText('Preview scene');
  await expect(page.locator('.preview-chapter')).toContainText('Not generated yet');
  await page.screenshot({ path: 'test-results/preview-interstitial-desktop.png' });
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  for (const key of ['n', 's', 'Delete', 'Backspace', 'ControlOrMeta+d', 'ControlOrMeta+z', 'ControlOrMeta+Shift+z']) await page.keyboard.press(key);
  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer(); value.items.add(new File(['ignored'], 'ignored.mp4', { type: 'video/mp4' })); return value;
  });
  await page.locator('.video-stage').dispatchEvent('drop', { dataTransfer: transfer });
  expect((await readProject(page)).storyFlow).toEqual(before.storyFlow);
  expect((await readProject(page)).interstitials).toEqual(before.interstitials);
  await edit(page).click();
  await expect(page.locator('.story-canvas')).toBeVisible();
  await expect(page.getByLabel('Interstitial prompt')).toHaveValue('Keep this prompt');
  await expect(page.locator('.story-scroll')).toHaveAttribute('style', camera!);
  await expect(page.locator('.story-clip.selected')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('preview preserves playback and supports pointer seeking, captions, speed, and fullscreen', async ({ page }) => {
  await openVideo(page);
  await page.getByLabel('Choose subtitle file').setInputFiles({ name: 'test.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00.000 --> 00:04.000\nViewer captions\n') });
  await preview(page).click();
  await expect(page.locator('.playback-captions')).toContainText('Viewer captions');
  await page.getByRole('button', { name: 'Toggle captions' }).click();
  await expect(page.locator('.playback-captions')).toBeHidden();
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('0.5');
  await seek(page).press('Home');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number(await seek(page).inputValue())).toBeGreaterThan(.1);
  await edit(page).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeAttached();
  await preview(page).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const bar = (await seek(page).boundingBox())!;
  await seek(page).click({ position: { x: bar.width / 2, y: bar.height / 2 } });
  expect(Number(await seek(page).inputValue())).toBeCloseTo(Number(await seek(page).getAttribute('max')) / 2, 0);
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.locator('.story-canvas')).toBeHidden();
  await expect(page.getByRole('button', { name: /^(Show|Hide) timeline$/ })).toHaveCount(0);
  await expect(seek(page)).toBeVisible();
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect(preview(page)).toHaveAttribute('aria-pressed', 'true');
});

test('audience answers work in preview and the timeline follows the chosen branch', async ({ page }) => {
  await openVideo(page); await addQuestionTemplate(page);
  await page.locator('.story-clip.type-conditional .story-filmstrip').press('Home');
  await preview(page).click();
  await expect(page.locator('.preview-marker.choice')).toHaveCount(1);
  const choices = page.getByRole('group', { name: 'Choose an answer' });
  await expect(choices).toBeVisible();
  const answer = choices.getByRole('button').last();
  const project = await readProject(page);
  const choice = project.storyFlow.nodes.find((node: any) => node.kind === 'conditional');
  const selectedEdge = project.storyFlow.edges.filter((edge: any) => edge.from === choice.id && edge.event === 'answer').at(-1);
  const label = project.storyFlow.nodes.find((node: any) => node.id === selectedEdge.to).name;
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('2');
  await answer.click();
  await expect(answer).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.preview-marker.scene').last()).toHaveAttribute('title', new RegExp(label));
  await page.screenshot({ path: 'test-results/preview-choice-desktop.png' });
  await expect.poll(async () => (await seek(page).getAttribute('aria-valuetext')) ?? '').toContain(label);
  await expect(page.locator('.story-canvas')).toBeHidden();
});

for (const width of [1440, 390, 320]) test(`preview controls stay fixed through buffering and errors at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await openVideo(page); await preview(page).click();
  await expect(page.locator('.buffering')).toHaveCount(0);
  const before = await geometry(page);
  if (width <= 660) {
    const workspace = (await page.locator('.workspace-grid').boundingBox())!;
    const stage = (await page.locator('.video-stage').boundingBox())!;
    expect(Math.abs(stage.y + stage.height / 2 - workspace.y - workspace.height / 2)).toBeLessThan(2);
    expect(stage.height).toBeLessThan(width);
  }
  await page.evaluate(async () => {
    const { CanvasMediaDecks } = await import('/src/features/player/CanvasMediaDecks.ts' as string);
    const render = CanvasMediaDecks.prototype.render;
    (window as any).previewBuffering = true;
    CanvasMediaDecks.prototype.render = function (...args: any[]) { return (window as any).previewBuffering ? false : render.apply(this, args); };
  });
  await expect(page.locator('.buffering')).toBeVisible();
  expect(await geometry(page)).toEqual(before);
  await page.screenshot({ path: `test-results/preview-buffering-${width}.png` });
  await page.evaluate(() => { (window as any).previewBuffering = false; });
  await expect(page.locator('.buffering')).toHaveCount(0);
  expect(await geometry(page)).toEqual(before);
  await page.evaluate(() => {
    document.querySelector('.player-card')!.requestFullscreen = async () => { throw new Error('Unavailable'); };
  });
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Fullscreen is not available');
  expect(await geometry(page)).toEqual(before);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  expect(await geometry(page)).toEqual(before);
  for (const button of [edit(page), preview(page), page.getByRole('button', { name: 'Fullscreen', exact: true })]) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `test-results/preview-ready-${width}.png` });
});

test('an empty project has a stable disabled preview and can return to editing', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: /^New project/ }).click();
  await preview(page).click();
  await expect(seek(page)).toBeDisabled();
  await expect(page.getByText('No video to preview. Add clips in Edit mode.')).toBeVisible();
  await edit(page).click();
  await expect(page.getByRole('button', { name: 'Import videos', exact: true })).toBeVisible();
});
