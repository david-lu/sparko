import { fitAll, saveAndReopen, test, expect, type Page } from './fixtures';

const saved = (page: Page) => page.evaluate(async () => { const { readActiveProject } = await import('/src/features/project/database.ts' as string); return readActiveProject(); });
async function open(page: Page) {
  await page.goto('/'); await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled();
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4'); await expect(page.locator('.story-clip')).toHaveCount(1);
  await page.locator('.story-filmstrip').focus(); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('s');
  await page.locator('.story-clip').last().locator('.story-filmstrip').focus(); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('s');
  await expect(page.locator('.story-clip')).toHaveCount(3); await fitAll(page);
  return saved(page);
}

for (const width of [1440, 390]) test(`crossfades are shaped and timed on a graph at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const project = await open(page), connection = project.storyFlow.edges[0];
  const link = async () => (await saved(page)).storyFlow.edges.find((edge: { id: string }) => edge.id === connection.id);
  await page.locator(`[data-edge-id="${connection.id}"] .story-crossfade`).click();
  const inspector = page.locator('.connection-inspector'), duration = page.getByLabel('Video crossfade duration', { exact: true });
  const graph = page.getByRole('group', { name: 'Video crossfade curve', exact: true }), end = page.getByRole('slider', { name: 'Video crossfade end', exact: true });
  const shapes = page.getByRole('group', { name: 'Video crossfade shape', exact: true });
  const positions = () => inspector.evaluate(el => {
    const top = el.getBoundingClientRect().top;
    return [...el.querySelectorAll('.crossfade-curve-tools,.connection-reference-status,.connection-timing')].map(node => Math.round(node.getBoundingClientRect().top - top));
  });
  await expect(duration).toHaveValue('0'); await expect(graph).toBeVisible();
  await expect(shapes.getByRole('button', { name: 'Linear', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const cut = await positions();

  // A length typed in the field and the graph's end point are the same value.
  await duration.fill('0.25'); await expect(end).toHaveAttribute('aria-valuenow', '0.25');
  await expect(page.getByRole('img', { name: /^Cut at 0\.125 seconds/ })).toHaveCount(1);
  expect(await positions()).toEqual(cut);

  await shapes.getByRole('button', { name: 'S-curve', exact: true }).click();
  await expect(shapes.getByRole('button', { name: 'S-curve', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await link()).videoCrossfadeCurve?.interpolation).toBe('bezier');
  expect((await link()).audioCrossfadeCurve).toBeUndefined();
  await expect(page.locator(`.story-transition-region[data-edge-id="${connection.id}"][data-channel="video"]`).first()).toHaveAttribute('style', /--fade-shape: polygon\(/);

  await graph.scrollIntoViewIfNeeded();
  const box = (await end.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 40, { steps: 6 });
  await expect(end).not.toHaveAttribute('aria-valuenow', '0.25');
  await page.mouse.up();
  const longer = Number(await duration.inputValue());
  expect(longer).toBeGreaterThan(.25);
  await expect.poll(async () => (await link()).videoCrossfade).toBeCloseTo(longer, 3);
  expect((await link()).videoCrossfadeCurve.interpolation).toBe('bezier');

  await page.getByRole('button', { name: 'Add video crossfade point', exact: true }).click();
  const point = page.getByRole('button', { name: 'Video crossfade point 1', exact: true });
  await expect(point).toHaveCount(1);
  await expect.poll(async () => (await link()).videoCrossfadeCurve.points.length).toBe(3);
  const level = (await link()).videoCrossfadeCurve.points[1].strength;
  await point.focus(); await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(async () => (await link()).videoCrossfadeCurve.points[1].strength).toBeCloseTo(Math.min(1, level + .1), 3);
  await expect(page.getByRole('button', { name: 'Video crossfade point 1 out handle', exact: true })).toHaveCount(1);
  expect(await positions()).toEqual(cut);
  await page.screenshot({ path: `test-results/crossfade-curve-${width}.png`, fullPage: true });

  // Delete removes the point, never the connection being edited.
  await page.keyboard.press('Delete');
  await expect(point).toHaveCount(0);
  await expect.poll(async () => (await link())?.videoCrossfadeCurve?.points.length).toBe(2);
  expect((await saved(page)).storyFlow.edges).toHaveLength(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(point).toHaveCount(1);

  await saveAndReopen(page); await fitAll(page);
  await page.locator(`[data-edge-id="${connection.id}"] .story-crossfade`).click();
  await expect(point).toHaveCount(1); await expect(duration).toHaveValue(String(longer));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const clip = page.locator('.story-clip').first(), clipId = await clip.getAttribute('data-node-id');
  await clip.locator('.story-clip-title').click(); await page.getByRole('checkbox', { name: 'Loop', exact: true }).check();
  await expect(page.getByRole('group', { name: 'Loop video crossfade curve', exact: true })).toBeVisible();
  await page.getByRole('group', { name: 'Loop audio crossfade shape', exact: true }).getByRole('button', { name: 'Slow start', exact: true }).click();
  await expect.poll(async () => (await saved(page)).storyFlow.nodes.find((node: { id: string }) => node.id === clipId)?.loopAudioCrossfadeCurve?.interpolation).toBe('bezier');
  expect((await saved(page)).storyFlow.nodes.find((node: { id: string }) => node.id === clipId)?.loopVideoCrossfadeCurve).toBeUndefined();
  await page.screenshot({ path: `test-results/crossfade-curve-loop-${width}.png`, fullPage: true });
});
