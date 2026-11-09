import { test, expect, openVideo, addBridge, readProject, type Page } from './fixtures';

async function start(page: Page) {
  await openVideo(page); await addBridge(page);
  const nodeId = (await readProject(page)).storyFlow.nodes.find((n: any) => n.interstitialId).id;
  await page.getByLabel('Import library assets', { exact: true }).setInputFiles('src/app/tutorial/images/save.png');
  await expect(page.getByRole('button', { name: 'Library asset save.png', exact: true })).toBeVisible();
  await page.locator(`[data-node-id="${nodeId}"] .story-clip-title`).click();
  await page.getByRole('button', { name: 'Edit generation timeline', exact: true }).click();
  return page.getByRole('region', { name: 'Generation timeline', exact: true });
}

for (const width of [1440, 390]) test(`Library drops preview position and survive inspector selection at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const editor = await start(page);
  await expect(page.locator('.story-scroll')).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Generation timeline', exact: true })).toHaveCount(0);
  const library = page.getByRole('button', { name: 'Library asset save.png', exact: true });
  await library.click(); await expect(editor).toBeVisible(); // Inspector may change; editing stays open.
  const source = (await library.boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2 + 8, { steps: 3 });
  const tracks = editor.locator('.generation-timeline-tracks'); await tracks.scrollIntoViewIfNeeded();
  const box = (await tracks.boundingBox())!;
  await page.mouse.move(box.x + box.width * .45, box.y + 80, { steps: 10 }); await page.mouse.move(box.x + box.width * .45, box.y + 80);
  await expect(editor.locator('.generation-drop-preview.image')).toBeVisible();
  await expect(editor.locator('.generation-placement-time')).toContainText('frame');
  const imageFrame = Number((await editor.locator('.generation-placement-time').innerText()).match(/frame (\d+)/)![1]);
  const before = await readProject(page); expect(before.interstitials[0].keyframes ?? []).toHaveLength(0);
  await page.screenshot({ path: `test-results/generation-library-drag-${width}.png` });
  await page.mouse.up();
  await expect.poll(async () => (await readProject(page)).interstitials[0].keyframes?.length).toBe(1);
  const keyframe = (await readProject(page)).interstitials[0].keyframes[0];
  expect(keyframe.frame).toBe(imageFrame - 39);
  expect(Math.abs(imageFrame - Math.round(226 * .45))).toBeLessThanOrEqual(1);
  await expect(editor.locator('.generation-drop-preview')).toHaveCount(0);
  await expect(editor.getByRole('navigation', { name: 'Timeline properties' })).toHaveCount(0);

  const video = page.getByRole('button', { name: 'Library asset interstitial-reference.mp4', exact: true });
  await video.scrollIntoViewIfNeeded(); const videoBox = (await video.boundingBox())!;
  await page.mouse.move(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height / 2); await page.mouse.down();
  await page.mouse.move(videoBox.x + videoBox.width / 2 + 12, videoBox.y + videoBox.height / 2 + 8, { steps: 3 });
  await tracks.scrollIntoViewIfNeeded(); const target = (await tracks.boundingBox())!;
  await page.mouse.move(target.x + target.width * .25, target.y + 30, { steps: 10 }); await page.mouse.move(target.x + target.width * .25, target.y + 30);
  await expect(editor.locator('.generation-drop-preview.video')).toBeVisible();
  const videoFrame = Number((await editor.locator('.generation-placement-time').innerText()).match(/frame (\d+)/)![1]);
  await page.mouse.up();
  await expect.poll(async () => (await readProject(page)).interstitials[0].timelineVideos?.length).toBe(1);
  expect((await readProject(page)).interstitials[0].timelineVideos[0]).toMatchObject({ frame: videoFrame - 39, video: { outFrame: 96 } });
  await editor.getByRole('button', { name: 'Close generation timeline', exact: true }).click();
  await expect(editor).toHaveCount(0); await expect(page.locator('.story-scroll')).toBeVisible();
});
