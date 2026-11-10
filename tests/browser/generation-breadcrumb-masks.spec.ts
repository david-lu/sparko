import { test, expect, openVideo, addBridge, openGenerationTimeline, readProject } from './fixtures';
import { wavFixture } from '../fixtures/audio';

const box = (locator: import('@playwright/test').Locator) => locator.boundingBox().then(value => value && { y: Math.round(value.y), height: Math.round(value.height) });

for (const width of [1440, 390]) test(`the timeline heading shows project › clip › mask, and masks are free wherever there is input at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await openVideo(page); await addBridge(page);
  const project = await readProject(page), item = project.interstitials[0];
  const clip = project.storyFlow.nodes.find((node: { interstitialId?: string }) => node.interstitialId === item.id);
  const editor = await openGenerationTimeline(page), trail = editor.getByRole('navigation', { name: 'Breadcrumb', exact: true });
  await expect(trail.getByRole('listitem')).toHaveText([project.name, clip.name]);
  await expect(trail.locator('[aria-current=page]')).toHaveText(clip.name);
  const heading = editor.locator('.generation-timeline-heading'), idle = await box(heading);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await editor.getByRole('button', { name: 'Edit video mask', exact: true }).click();
  await expect(trail.getByRole('listitem')).toHaveText([project.name, clip.name, 'Video mask']);
  await expect(trail.locator('[aria-current=page]')).toHaveText('Video mask');
  expect(await box(heading)).toEqual(idle);
  // Nothing in the generated section can be kept: it is hatched and regenerates, but still takes pins.
  const graph = editor.locator('.mask-editor-graph'), hatch = graph.locator('.mask-no-input');
  await expect(hatch).toHaveCount(1);
  await expect(graph.locator('.mask-curve-raw')).toHaveCount(1);
  await graph.locator('.mask-generated-region').click({ button: 'right' });
  await editor.getByRole('menuitem', { name: 'Add keyframe', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Video body keyframe 2', exact: true })).toBeVisible();
  await editor.getByLabel('Keyframe regeneration', { exact: true }).fill('30');
  await editor.getByRole('button', { name: 'Apply video mask', exact: true }).click();
  await expect.poll(async () => (await readProject(page)).interstitials[0].videoMaskCurve?.body?.[1]?.strength).toBeCloseTo(.3);
  await expect(trail.getByRole('listitem')).toHaveText([project.name, clip.name]);
  // The lane draws what H3 receives: the empty generated section stays at 100%.
  const lane = await editor.getByRole('button', { name: 'Edit video mask', exact: true }).locator('path.mask-curve-line').getAttribute('d');
  expect(lane).toContain('L500,7 ');

  // The reference footage has no audio track, so all of the audio regenerates until sound is added.
  await editor.getByRole('button', { name: 'Edit audio mask', exact: true }).click();
  await expect(trail.getByRole('listitem')).toHaveText([project.name, clip.name, 'Audio mask']);
  await expect(graph.locator('.mask-no-input')).toHaveCount(1);
  await expect(graph.locator('.mask-no-input')).toHaveAttribute('data-start', '0.000');
  // The clip crumb closes the mask without applying it.
  await trail.getByRole('button', { name: clip.name, exact: true }).click();
  await expect(trail.getByRole('listitem')).toHaveCount(2);
  await editor.getByRole('button', { name: 'Add audio track', exact: true }).click();
  const ruler = editor.getByRole('slider', { name: 'Timeline ruler', exact: true });
  await ruler.press('Home'); for (let i = 0; i < 6; i++) await ruler.press('Shift+ArrowRight');
  await editor.getByLabel('Upload sounds', { exact: true }).setInputFiles([{ name: 'Line.wav', mimeType: 'audio/wav', buffer: wavFixture(1) }]);
  await expect(editor.getByRole('button', { name: 'Sound Line.wav on Audio 1', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Edit audio mask', exact: true }).click();
  await expect(graph.locator('.mask-no-input')).toHaveCount(2);
  await trail.getByRole('button', { name: clip.name, exact: true }).click();
  await editor.locator('.generation-sound-properties').getByRole('button', { name: 'Mute Track Audio 1', exact: true }).click();
  await editor.getByRole('button', { name: 'Edit audio mask', exact: true }).click();
  await expect(graph.locator('.mask-no-input')).toHaveCount(1);

  // The project crumb leaves the timeline for the story, discarding the open mask.
  await trail.getByRole('button', { name: project.name, exact: true }).click();
  await expect(page.getByRole('region', { name: 'Generation timeline', exact: true })).toHaveCount(0);
  expect((await readProject(page)).interstitials[0].audioMaskCurve).toBeUndefined();
});
