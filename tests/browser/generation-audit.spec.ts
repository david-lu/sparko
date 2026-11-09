import { test, expect, openVideo, addBridge, readProject, type Page } from './fixtures';

const timeline = (page: Page) => page.getByRole('region', { name: 'Generation timeline', exact: true });
const slider = (page: Page) => timeline(page).getByRole('slider', { name: 'Generation timeline playhead', exact: true });
async function open(page: Page) {
  await openVideo(page); await addBridge(page);
  await page.getByRole('button', { name: 'Edit generation timeline', exact: true }).click();
}
async function addVideo(page: Page) {
  await timeline(page).getByRole('button', { name: 'Add video', exact: true }).click();
  await timeline(page).getByLabel('Upload Timeline video', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(timeline(page).getByRole('group', { name: 'Timeline video', exact: true })).toHaveAttribute('aria-busy', 'false');
}

test('mobile keeps tracks above properties and both masks visible without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page);
  const bounds = await timeline(page).evaluate(el => ({ tracks: el.querySelector('.generation-timeline-scroll')!.getBoundingClientRect().toJSON(), properties: el.querySelector('.generation-selection-panel')!.getBoundingClientRect().toJSON() }));
  expect(bounds.tracks.bottom).toBeLessThanOrEqual(844);
  expect(bounds.tracks.bottom).toBeLessThanOrEqual(bounds.properties.top);
  await expect(timeline(page).getByRole('button', { name: 'Edit video mask', exact: true })).toBeInViewport();
  await expect(timeline(page).getByRole('button', { name: 'Edit audio mask', exact: true })).toBeInViewport();
});

for (const width of [1440, 390]) test(`mask edits have explicit Apply/Cancel and Escape cancels only the mask at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await open(page); await timeline(page).getByRole('button', { name: 'Edit video mask', exact: true }).click();
  await expect(timeline(page).getByRole('button', { name: 'Apply video mask', exact: true })).toBeInViewport();
  await expect(timeline(page).getByRole('button', { name: 'References', exact: true })).toHaveCount(0);
  await expect(timeline(page).getByRole('button', { name: 'Add video', exact: true, includeHidden: true })).toBeDisabled();
  const point = timeline(page).getByRole('button', { name: 'Video start keyframe 1', exact: true });
  await point.focus(); await point.press('ArrowUp');
  await page.keyboard.press('Escape');
  await expect(timeline(page)).toBeVisible(); await expect(timeline(page).locator('.mask-graph-editor')).toHaveCount(0);
  expect((await readProject(page)).interstitials[0].videoMaskCurve).toBeUndefined();
});

test('playback restarts from the final frame and follows the zoomed playhead', async ({ page }) => {
  await open(page); await slider(page).focus(); await slider(page).press('End');
  await timeline(page).getByRole('button', { name: 'Play timeline', exact: true }).click();
  await expect.poll(async () => Number(await slider(page).inputValue())).toBeLessThan(20);
  await expect(timeline(page).getByRole('button', { name: 'Pause timeline', exact: true })).toBeVisible();
  await timeline(page).getByRole('button', { name: 'Pause timeline', exact: true }).click();
  await slider(page).focus(); await slider(page).press('End');
  await timeline(page).getByLabel('Generation timeline zoom').selectOption('8');
  expect(await timeline(page).evaluate(el => { const lane = el.querySelector('.generation-timeline-scroll')!.getBoundingClientRect(), cursor = el.querySelector('.generation-cursor-line')!.getBoundingClientRect(); return cursor.x >= lane.x && cursor.x <= lane.right; })).toBe(true);
});

test('reference and video selection seek to the selected input', async ({ page }) => {
  await open(page); await slider(page).focus(); await slider(page).press('Home');
  await timeline(page).locator('.generation-reference-segment[data-side=end]').click();
  expect(Number(await slider(page).inputValue())).toBeGreaterThan(100);
  await addVideo(page); const first = (await readProject(page)).interstitials[0].timelineVideos[0];
  await slider(page).focus(); await slider(page).press('Home');
  await timeline(page).getByRole('button', { name: 'Add video', exact: true }).click();
  await timeline(page).getByLabel('Selected generation input').selectOption(`video:${first.id}`);
  expect(Number(await slider(page).inputValue())).toBe(39 + first.frame);
});

test('video moves and source trims stay inside the generated interval', async ({ page }) => {
  await open(page); await addVideo(page);
  await timeline(page).getByLabel('Video source out', { exact: true }).fill('999');
  await timeline(page).getByLabel('Video timeline time', { exact: true }).fill('999');
  const item = (await readProject(page)).interstitials[0], clip = item.timelineVideos[0];
  expect(clip.frame + clip.video.outFrame - clip.video.inFrame).toBeLessThanOrEqual(148);
  await expect(timeline(page).locator('.generation-property-status')).not.toContainText('fit inside');
});

test('video drag Escape cancels, keyboard moves, and delete restores focus', async ({ page }) => {
  await open(page); await addVideo(page);
  await timeline(page).getByLabel('Video source out', { exact: true }).fill('1');
  const first = (await readProject(page)).interstitials[0].timelineVideos[0].frame;
  const clip = timeline(page).getByRole('button', { name: 'Select timeline video 1', exact: true }), box = (await clip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x - 50, box.y + box.height / 2, { steps: 4 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(timeline(page)).toBeVisible(); expect((await readProject(page)).interstitials[0].timelineVideos[0].frame).toBe(first);
  await clip.focus(); await clip.press('ArrowLeft');
  expect((await readProject(page)).interstitials[0].timelineVideos[0].frame).toBe(first - 1);
  await clip.press('Delete'); await expect(timeline(page).getByRole('button', { name: 'Add video', exact: true })).toBeFocused();
});

test('switching videos cancels an old upload instead of retaining busy state or overwriting edits', async ({ page }) => {
  await open(page); await timeline(page).getByRole('button', { name: 'Add video', exact: true }).click();
  const first = (await readProject(page)).interstitials[0].timelineVideos[0].id;
  await page.evaluate(async () => {
    const { ProjectController } = await import('/src/features/project/ProjectController.ts' as string);
    const original = ProjectController.prototype.importAssets;
    const gate = new Promise<void>(resolve => { (window as any).finishVideoUpload = resolve; });
    ProjectController.prototype.importAssets = async function (...args: any[]) { await gate; return original.apply(this, args); };
  });
  await timeline(page).getByLabel('Upload Timeline video', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(timeline(page).getByRole('group', { name: 'Timeline video', exact: true })).toHaveAttribute('aria-busy', 'true');
  await timeline(page).getByRole('button', { name: 'Add video', exact: true }).click();
  await expect(timeline(page).getByRole('group', { name: 'Timeline video', exact: true })).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => (window as any).finishVideoUpload());
  await expect.poll(async () => (await readProject(page)).library.length).toBeGreaterThan(1);
  const clips = (await readProject(page)).interstitials[0].timelineVideos;
  expect(clips).toHaveLength(2); expect(clips.find((c: any) => c.id === first).video).toBeUndefined();
});

test('nearby image keyframes can each be selected without zooming', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page);
  await timeline(page).getByRole('button', { name: 'Add image keyframe', exact: true }).click();
  await timeline(page).getByLabel('Keyframe frame', { exact: true }).fill('87');
  await timeline(page).getByRole('button', { name: 'Add image keyframe', exact: true }).click();
  await timeline(page).getByLabel('Keyframe frame', { exact: true }).fill('88');
  await timeline(page).getByLabel('2 nearby keyframes', { exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Nearby image keyframes', exact: true });
  await menu.getByRole('menuitem').first().click();
  await expect(timeline(page).getByLabel('Keyframe frame', { exact: true })).toHaveValue('87');
  await timeline(page).getByLabel('2 nearby keyframes', { exact: true }).click();
  await menu.getByRole('menuitem').last().click();
  await expect(timeline(page).getByLabel('Keyframe frame', { exact: true })).toHaveValue('88');
});

for (const cancel of ['pointercancel', 'lostpointercapture']) test(`image drag previews its tentative frame and ${cancel} restores the playhead`, async ({ page }) => {
  await open(page); const region = timeline(page);
  await region.getByRole('button', { name: 'Add image keyframe', exact: true }).click();
  await region.getByLabel('Upload Keyframe image', { exact: true }).setInputFiles('src/app/tutorial/images/save.png');
  await expect(region.getByRole('group', { name: 'Keyframe image', exact: true })).toHaveAttribute('aria-busy', 'false');
  const marker = region.getByRole('button', { name: 'Select image keyframe 1', exact: true });
  const before = (await readProject(page)).interstitials[0].keyframes;
  const frame = await slider(page).inputValue(); await marker.hover(); const box = (await marker.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 6 });
  await expect(slider(page)).not.toHaveValue(frame);
  await expect(region.locator('.generation-player-screen img')).toBeVisible();
  expect((await readProject(page)).interstitials[0].keyframes).toEqual(before);
  await marker.dispatchEvent(cancel); await page.mouse.up();
  await expect(slider(page)).toHaveValue(frame);
  expect((await readProject(page)).interstitials[0].keyframes).toEqual(before);
});

test('editing input duration pauses the transport and clamps every input seek control', async ({ page }) => {
  await open(page); const region = timeline(page);
  await slider(page).press('End'); await slider(page).press('ArrowLeft');
  await region.getByRole('button', { name: 'Play timeline', exact: true }).click();
  await region.getByLabel('Duration', { exact: true }).fill('2');
  await expect(region.getByRole('button', { name: 'Play timeline', exact: true })).toBeVisible();
  const max = await slider(page).getAttribute('max');
  await expect(region.getByRole('slider', { name: 'Timeline ruler', exact: true })).toHaveAttribute('aria-valuemax', max!);
  await expect(region.getByRole('slider', { name: 'Audio waveform playhead', exact: true })).toHaveAttribute('aria-valuemax', max!);
  expect(Number(await slider(page).inputValue())).toBeLessThanOrEqual(Number(max));
});
