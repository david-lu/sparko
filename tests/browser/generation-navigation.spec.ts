import { test, expect, openVideo, addBridge, readProject, dragIntoView, type Page } from './fixtures';

const editor = (page: Page) => page.getByRole('region', { name: 'Generation timeline', exact: true });
const playhead = (page: Page) => editor(page).getByRole('slider', { name: 'Generation timeline playhead', exact: true });
async function open(page: Page, saved = false) {
  await openVideo(page); await addBridge(page);
  if (saved) {
    const { bytes, nodeId } = await page.evaluate(async () => {
      const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
      const { packProject } = await import('/src/features/project/archive.ts' as string);
      const project = await readActiveProject(), item = project.interstitials[0], media = await readAsset(project.source.assetId);
      item.phase = 'ready'; item.result = { assetId: media.id, url: 'asset:' + media.id, start: 0, duration: 4, totalDuration: 4 };
      const archive = await packProject(project, [media], new AbortController().signal, () => {});
      return { bytes: [...new Uint8Array(await archive.arrayBuffer())], nodeId: project.storyFlow.nodes.find((n: any) => n.interstitialId === item.id).id };
    });
    await page.getByLabel('Choose project file', { exact: true }).setInputFiles({ name: 'Navigation.sparko', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
    await page.locator(`[data-node-id="${nodeId}"] .story-clip-title`).click();
  }
  await page.getByRole('button', { name: 'Edit generation timeline', exact: true }).click();
}

for (const width of [1440, 390]) test(`footage and zoomed ruler scrub precisely without opening duration at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await open(page);
  const region = editor(page), body = region.getByRole('button', { name: 'Preview generated section', exact: true });
  await expect(region.getByRole('button', { name: 'Edit audio mask', exact: true })).toBeInViewport();
  if (width === 390) {
    expect((await page.locator('.main-column').boundingBox())!.y + (await page.locator('.main-column').boundingBox())!.height).toBeLessThanOrEqual((await page.locator('.sidebar').boundingBox())!.y);
    await page.screenshot({ path: 'test-results/generation-navigation-mobile-open.png' });
  }
  await body.scrollIntoViewIfNeeded();
  const original = (await readProject(page)).interstitials[0].duration, box = (await body.boundingBox())!;
  await body.click({ position: { x: box.width * .25, y: 20 } });
  expect(Math.abs(Number(await playhead(page).inputValue()) - (39 + 148 * .25))).toBeLessThanOrEqual(1);
  await expect(region.getByLabel('Duration', { exact: true })).not.toBeFocused();
  await expect(page.locator('.interstitial-time-popover')).toHaveCount(0);
  await page.mouse.move(box.x + box.width * .25, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7, box.y + 20, { steps: 5 });
  await expect(region.locator('.generation-placement-time')).toBeVisible();
  expect(Math.abs(Number(await playhead(page).inputValue()) - (39 + 148 * .7))).toBeLessThanOrEqual(1);
  await page.mouse.up();
  expect((await readProject(page)).interstitials[0].duration).toBe(original);

  const reference = region.locator('.generation-reference-segment').first(), ref = (await reference.boundingBox())!;
  await reference.click({ position: { x: ref.width * .6, y: 20 } });
  expect(Math.abs(Number(await playhead(page).inputValue()) - 39 * .6)).toBeLessThanOrEqual(1);
  await expect(region.getByRole('button', { name: 'Input', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const ruler = region.getByRole('slider', { name: 'Timeline ruler', exact: true });
  await ruler.focus(); await ruler.press('Home'); await ruler.press('ArrowRight'); await ruler.press('Shift+ArrowRight');
  await expect(playhead(page)).toHaveValue('11');
  await ruler.press('Space'); await expect(region.getByRole('button', { name: 'Pause timeline', exact: true })).toBeVisible();
  await ruler.press('Space'); await expect(region.getByRole('button', { name: 'Play timeline', exact: true })).toBeVisible();
  await ruler.press('Home'); await region.getByLabel('Generation timeline zoom').selectOption('4');
  await ruler.scrollIntoViewIfNeeded();
  const scroll = region.locator('.generation-timeline-scroll'), view = (await scroll.boundingBox())!, track = (await ruler.boundingBox())!;
  const from = view.x + 40, to = view.x + view.width - 30, y = track.y + 12;
  const offset = await scroll.evaluate(el => el.scrollLeft);
  await page.mouse.move(from, y); await page.mouse.down(); await page.mouse.move(to, y, { steps: 8 });
  expect(await scroll.evaluate(el => el.scrollLeft)).toBe(offset);
  expect(Math.abs(Number(await playhead(page).inputValue()) - Math.round((to - track.x) / track.width * 226))).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(region).toBeVisible(); await expect(playhead(page)).toHaveValue('0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `test-results/generation-navigation-${width}.png` });
});

for (const width of [1440, 390]) test(`scrubbing keeps the chosen mode and input gaps stay black with a saved result at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await open(page, true);
  const region = editor(page), input = region.getByRole('button', { name: 'Input', exact: true }), generated = region.getByRole('button', { name: 'Generated', exact: true });
  const screen = region.locator('.generation-player-screen'), ruler = region.getByRole('slider', { name: 'Timeline ruler', exact: true });
  const waveform = region.getByRole('slider', { name: 'Audio waveform playhead', exact: true });
  const body = region.getByRole('button', { name: 'Preview generated section', exact: true });
  const before = await readProject(page);
  await region.locator('.generation-reference-segment').first().click();
  await expect(screen.locator('video')).toBeVisible();
  await body.click();
  await expect(input).toHaveAttribute('aria-pressed', 'true');
  await expect(screen).toHaveAttribute('data-empty', 'true');
  await expect(screen.locator('video,img')).toHaveCount(0); await expect(screen).toHaveText('');
  await expect(screen).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await body.press('Enter'); await expect(playhead(page)).toHaveValue('39');
  await expect(screen).toHaveAttribute('data-empty', 'true');
  await region.getByRole('button', { name: 'Play timeline', exact: true }).click();
  await expect.poll(async () => Number(await playhead(page).inputValue())).toBeGreaterThan(44);
  await expect(input).toHaveAttribute('aria-pressed', 'true'); await expect(screen.locator('video,img')).toHaveCount(0);
  await region.getByRole('button', { name: 'Pause timeline', exact: true }).click();
  await generated.click();
  await expect(ruler).toHaveAttribute('aria-valuemax', '95'); await expect(waveform).toHaveAttribute('aria-valuemax', '95');
  await ruler.press('End'); await expect(playhead(page)).toHaveValue('95');
  await region.locator('.generation-reference-segment').first().click();
  await expect(generated).toHaveAttribute('aria-pressed', 'true');
  await expect(screen.locator('video')).toBeVisible();
  await input.click(); await expect(ruler).toHaveAttribute('aria-valuemax', '225');
  const from = (await region.locator('.generation-reference-segment').first().boundingBox())!, to = (await body.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 12); await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 12, { steps: 8 });
  await expect(screen).toHaveAttribute('data-empty', 'true'); await expect(input).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.up();
  expect((await readProject(page)).interstitials).toEqual(before.interstitials);
  await page.screenshot({ path: `test-results/generation-input-gap-${width}.png` });
});

test('selection shows the right media and timing edits follow the selected input', async ({ page }) => {
  await open(page, true); const region = editor(page);
  const body = region.getByRole('button', { name: 'Preview generated section', exact: true }), box = (await body.boundingBox())!;
  await body.click({ position: { x: box.width * .25, y: 20 } });
  await expect(region.getByRole('button', { name: 'Input', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(region.locator('.generation-player-screen')).toHaveAttribute('data-empty', 'true');
  expect(Math.abs(Number(await playhead(page).inputValue()) - 76)).toBeLessThanOrEqual(1);
  await region.getByRole('button', { name: 'Generated', exact: true }).click();
  await region.getByRole('slider', { name: 'Timeline ruler', exact: true }).press('End');
  await expect(playhead(page)).toHaveValue('95'); // Saved video is shorter than the edited input timeline.
  await region.locator('.generation-reference-segment').first().click();
  await expect(region.getByRole('button', { name: 'Generated', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await region.getByRole('button', { name: 'Input', exact: true }).click();
  await expect(region.getByRole('button', { name: 'Input', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await region.getByRole('button', { name: 'Add image keyframe', exact: true }).click();
  await region.getByLabel('Upload Keyframe image', { exact: true }).setInputFiles('src/app/tutorial/images/save.png');
  await expect(region.getByRole('group', { name: 'Keyframe image', exact: true })).toHaveAttribute('aria-busy', 'false');
  const previousFrame = await region.getByLabel('Keyframe frame', { exact: true }).inputValue();
  await region.getByLabel('Keyframe frame', { exact: true }).fill('70');
  await expect(playhead(page)).toHaveValue('70'); await expect(region.locator('.generation-player-screen img')).toBeVisible();
  await region.getByLabel('Keyframe frame', { exact: true }).press('ControlOrMeta+z');
  await expect(region.getByLabel('Keyframe frame', { exact: true })).toHaveValue(previousFrame);
  await region.getByLabel('Keyframe frame', { exact: true }).press('ControlOrMeta+Shift+z');
  await expect(region.getByLabel('Keyframe frame', { exact: true })).toHaveValue('70');
  await region.getByRole('button', { name: 'Generated', exact: true }).click();
  await region.getByRole('button', { name: 'Select image keyframe 1', exact: true }).click();
  await expect(region.getByRole('button', { name: 'Input', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(region.locator('.generation-player-screen img')).toBeVisible();

  await region.getByRole('button', { name: 'Add video', exact: true }).click();
  await region.getByLabel('Upload Timeline video', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(region.getByRole('group', { name: 'Timeline video', exact: true })).toHaveAttribute('aria-busy', 'false');
  await region.getByLabel('Video source out', { exact: true }).fill('1');
  await region.getByLabel('Video timeline time', { exact: true }).fill('4');
  await expect(playhead(page)).toHaveValue('96');
  await region.getByRole('button', { name: 'Generated', exact: true }).click();
  await region.getByLabel('Selected generation input', { exact: true }).selectOption({ label: 'Video 1 · interstitial-reference.mp4' });
  await expect(region.getByRole('button', { name: 'Input', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(playhead(page)).toHaveValue('96');
  await region.getByRole('button', { name: 'Close generation timeline', exact: true }).click();
  await expect(page.locator('.generation-summary-videos b')).toHaveCount(1);
});

test('mask editing and other media playback pause the generation player', async ({ page }) => {
  await open(page); const region = editor(page), ruler = region.getByRole('slider', { name: 'Timeline ruler', exact: true });
  await ruler.press('Home'); await region.getByRole('button', { name: 'Play timeline', exact: true }).click();
  await expect.poll(async () => Number(await playhead(page).inputValue())).toBeGreaterThan(2);
  await region.getByRole('button', { name: 'Edit video mask', exact: true }).click();
  const frame = await region.locator('[aria-label="Generation timeline playhead"]').inputValue();
  await expect(region.locator('.generation-player-screen video')).toHaveJSProperty('paused', true);
  await region.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(playhead(page)).toHaveValue(frame);
  await expect(region.getByRole('button', { name: 'Play timeline', exact: true })).toBeVisible();
  await ruler.press('Home'); await region.getByRole('button', { name: 'Play timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Library asset interstitial-reference.mp4', exact: true }).click();
  const other = page.locator('.asset-inspector .asset-preview video');
  await expect(other).toBeVisible(); await other.evaluate((video: HTMLVideoElement) => video.play());
  await expect(region.getByRole('button', { name: 'Play timeline', exact: true })).toBeVisible();
  await expect(region.locator('.generation-player-screen video')).toHaveJSProperty('paused', true);
  await other.evaluate((video: HTMLVideoElement) => video.pause());
  await ruler.press('Home'); await region.getByRole('button', { name: 'Play timeline', exact: true }).click();
  await region.locator('.generation-player-screen video').evaluate(video => { (window as any).lastGenerationVideo = video; });
  await region.getByRole('button', { name: 'Close generation timeline', exact: true }).click();
  expect(await page.evaluate(() => (window as any).lastGenerationVideo.paused)).toBe(true);
});

for (const width of [1440, 390]) test(`failed Library drop stays visible without shifting the timeline at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await open(page);
  await page.getByLabel('Import library assets', { exact: true }).setInputFiles({ name: 'unsupported.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') });
  const region = editor(page), tracks = region.locator('.generation-timeline-tracks');
  const geometry = () => region.locator('.generation-timeline-scroll,.generation-drop-status').evaluateAll(elements => elements.map(el => ({ y: (el as HTMLElement).offsetTop, height: el.clientHeight })));
  const before = await geometry();
  await dragIntoView(page, page.getByRole('button', { name: 'Library asset unsupported.gif', exact: true }), tracks);
  await expect(region.locator('.generation-drop-status')).toContainText('Use a PNG, JPEG or WebP image');
  await expect(region.locator('.generation-drop-status')).toBeInViewport();
  expect(await geometry()).toEqual(before);
  expect((await readProject(page)).interstitials[0].keyframes ?? []).toHaveLength(0);
});
