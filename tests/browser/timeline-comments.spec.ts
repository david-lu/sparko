import { test, expect, readProject, type Page } from './fixtures';

const open = async (page: Page) => {
  await page.goto('/'); await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled();
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.story-clip')).toHaveCount(1);
};
const layout = (page: Page) => Promise.all(['.story-toolbar', '.story-scroll', '.story-status', '.video-stage'].map(selector => page.locator(selector).boundingBox()));
const comments = async (page: Page) => (await readProject(page)).storyFlow.comments ?? [];
const status = (page: Page) => page.locator('.story-status [role="status"]');
const pins = (page: Page) => page.locator('[data-comment-id]');

test('comments pin to clip moments or the canvas, edit in place and survive moves, undo and clip deletion', async ({ page }) => {
  await open(page);
  const tool = page.getByRole('button', { name: 'Comment tool', exact: true }), before = await layout(page);
  await tool.click(); await expect(tool).toHaveAttribute('aria-pressed', 'true'); await expect(status(page)).toContainText('Comment tool');

  const film = (await page.locator('.story-filmstrip').boundingBox())!, clip = (await page.locator('.story-clip').boundingBox())!;
  await page.mouse.click(film.x + film.width / 2, film.y + film.height / 2);
  await expect(tool).toHaveAttribute('aria-pressed', 'false');
  const draft = page.getByRole('dialog', { name: 'New comment' }), text = draft.getByLabel('Comment text', { exact: true });
  await expect(draft).toBeVisible(); await expect(text).toBeFocused();
  await expect(page.locator('.story-playhead')).toBeVisible();
  // The editor floats beside its pin; nothing in the editor moves.
  expect(await layout(page)).toEqual(before);
  await page.screenshot({ path: 'test-results/comment-draft-1440.png' });
  await expect(draft.getByRole('button', { name: 'Comment', exact: true })).toBeDisabled();
  await text.fill('Hold on the reaction a beat longer'); await text.press('ControlOrMeta+Enter');
  await expect(draft).toHaveCount(0);

  const pin = page.getByRole('button', { name: /^Comment on .+: Hold on the reaction a beat longer$/ });
  await expect(pin).toBeFocused(); await expect(pin).toContainText('Hold on the reaction a beat longer');
  let graph = (await readProject(page)).storyFlow;
  const node = graph.nodes[0], frames = node.source.outFrame - node.source.inFrame, [saved] = graph.comments;
  expect(saved).toMatchObject({ text: 'Hold on the reaction a beat longer', anchor: { nodeId: node.id } });
  expect(Math.abs(saved.anchor.frame - node.source.inFrame - frames / 2)).toBeLessThanOrEqual(2);
  // The square corner marks the moment on the clip's bottom edge.
  const pinBox = (await pin.boundingBox())!;
  expect(Math.abs(pinBox.x - (film.x + film.width / 2))).toBeLessThanOrEqual(2);
  expect(Math.abs(pinBox.y - (clip.y + clip.height))).toBeLessThanOrEqual(2);
  expect(await layout(page)).toEqual(before);

  // Reopen to edit and resolve. Escape leaves unsaved edits behind.
  await page.mouse.click(pinBox.x + 10, pinBox.y + 10);
  const editor = page.getByRole('dialog', { name: 'Comment', exact: true });
  await expect(editor.getByLabel('Comment text', { exact: true })).toHaveValue('Hold on the reaction a beat longer');
  await editor.getByRole('button', { name: 'Resolve comment', exact: true }).click();
  const resolved = page.getByRole('dialog', { name: 'Resolved comment', exact: true });
  await expect(resolved).toBeVisible(); expect((await comments(page))[0].resolved).toBe(true);
  await resolved.getByLabel('Comment text', { exact: true }).fill('Discarded');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await comments(page))[0].text).toBe('Hold on the reaction a beat longer');
  await expect(page.getByRole('button', { name: /^Resolved comment on / })).toHaveCount(1);

  // Dragging off the clip leaves the comment on the canvas; undo pins it back.
  const canvas = (await page.locator('.story-scroll').boundingBox())!, blank = { x: canvas.x + canvas.width * .25, y: (canvas.y + clip.y) / 2 };
  expect(clip.y - canvas.y).toBeGreaterThan(70);
  await page.mouse.move(pinBox.x + 10, pinBox.y + 10); await page.mouse.down(); await page.mouse.move(blank.x, blank.y, { steps: 8 });
  await expect(status(page)).toContainText('Release to place the comment here');
  await page.mouse.up();
  expect((await comments(page))[0].anchor).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  const moved = (await pins(page).boundingBox())!;
  expect(Math.abs(moved.x - blank.x)).toBeLessThanOrEqual(2); expect(Math.abs(moved.y - blank.y)).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await comments(page))[0].anchor).toEqual(saved.anchor);

  // A comment typed on the canvas is kept when clicking elsewhere.
  await page.mouse.click(blank.x, blank.y, { button: 'right' });
  await page.getByRole('menuitem', { name: /^Add comment/ }).click();
  await page.getByRole('dialog', { name: 'New comment' }).getByLabel('Comment text', { exact: true }).fill('Add a title card here');
  await page.mouse.click(canvas.x + canvas.width * .75, blank.y);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await comments(page)).map((c: { text: string }) => c.text)).toEqual(['Hold on the reaction a beat longer', 'Add a title card here']);

  // Deleting a clip keeps its comments where they were.
  await page.locator('.story-clip-title').click(); await page.keyboard.press('Delete');
  await expect(page.locator('.story-clip')).toHaveCount(0);
  await expect(pins(page)).toHaveCount(2);
  expect((await comments(page))[0].anchor).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.story-clip')).toHaveCount(1);
  expect((await comments(page))[0].anchor).toEqual(saved.anchor);

  // Arrow keys nudge a pin by a frame; Delete removes the focused pin.
  const title = page.getByRole('button', { name: /^Comment on .+: Add a title card here$/ });
  await title.focus(); await page.keyboard.press('Delete');
  await expect(pins(page)).toHaveCount(1);
  const remaining = pins(page); await remaining.focus(); await page.keyboard.press('ArrowRight');
  expect((await comments(page))[0].anchor.frame).toBe(saved.anchor.frame + 1);
  await expect(page.locator('.story-clip')).toHaveCount(1);
});

test('the comment editor fits a narrow screen without shifting the timeline', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page);
  const before = await layout(page), film = (await page.locator('.story-filmstrip').boundingBox())!;
  await page.mouse.click(film.x + film.width * .8, film.y + film.height / 2, { button: 'right' });
  await page.getByRole('menuitem', { name: /^Comment on this moment/ }).click();
  const draft = page.getByRole('dialog', { name: 'New comment' }), box = (await draft.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(8); expect(box.x + box.width).toBeLessThanOrEqual(382);
  expect(await layout(page)).toEqual(before);
  await page.screenshot({ path: 'test-results/comment-draft-390.png' });
  await draft.getByLabel('Comment text', { exact: true }).fill('Narrow note'); await draft.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(pins(page)).toHaveCount(1);
  expect(await layout(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('pins show their opening words until zoomed out, take a color, snap to the playhead and preview with a ghost', async ({ page }) => {
  await open(page);
  const film = (await page.locator('.story-filmstrip').boundingBox())!, canvas = (await page.locator('.story-scroll').boundingBox())!;
  // Park the playhead partway in, then aim a few pixels beside it.
  await page.mouse.click(film.x + film.width * .3, film.y + film.height / 2);
  const playhead = (await page.locator('.story-playhead').boundingBox())!, time = (await page.locator('.story-playhead>span').textContent())!;
  await page.getByRole('button', { name: 'Comment tool', exact: true }).click();
  const ghost = page.locator('.story-comment-pin.ghost');
  await page.mouse.move(canvas.x + 60, canvas.y + 30);
  await expect(ghost).toHaveClass(/on-canvas/); await expect(status(page)).toContainText('Comment tool');
  await page.mouse.move(playhead.x + 5, film.y + film.height / 2);
  await expect(ghost).toHaveClass(/on-clip/); await expect(ghost).toHaveClass(/snapped/); await expect(ghost).toContainText(time);
  await expect(status(page)).toContainText(`at ${time} · Snapped to playhead`);
  const ghostBox = (await ghost.boundingBox())!;
  expect(Math.abs(ghostBox.x - playhead.x)).toBeLessThanOrEqual(2);
  await page.mouse.click(playhead.x + 5, film.y + film.height / 2);
  await expect(ghost).toHaveCount(0);

  const draft = page.getByRole('dialog', { name: 'New comment' });
  await draft.getByRole('button', { name: 'Blue comment color', exact: true }).click();
  await expect(page.locator('[data-comment-id="new"]')).toHaveAttribute('data-color', 'blue');
  await draft.getByLabel('Comment text', { exact: true }).fill('Warmer grade on the close-up so it matches the wide shot');
  await draft.getByRole('button', { name: 'Comment', exact: true }).click();
  const first = page.getByRole('button', { name: new RegExp(`^Comment on .+ at ${time.replace('.', '\\.')}: Warmer grade`) });
  await expect(first).toHaveAttribute('data-color', 'blue'); await expect(first).toContainText('Warmer grade on the close-up');
  expect((await comments(page))[0].color).toBe('blue');

  // A close neighbour shortens the label, but it never drops below a few words.
  const firstBox = (await first.boundingBox())!;
  await page.getByRole('button', { name: 'Comment tool', exact: true }).click();
  await page.mouse.click(firstBox.x + 30, film.y + film.height / 2);
  await page.getByRole('dialog', { name: 'New comment' }).getByLabel('Comment text', { exact: true }).fill('Second');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(pins(page)).toHaveCount(2);
  await expect(first).toHaveAttribute('data-labelled', 'true');
  expect((await first.boundingBox())!.width).toBeGreaterThanOrEqual(70);

  // Recolor from the popover; Undo restores the previous color.
  await page.mouse.click(firstBox.x + 8, firstBox.y + 10);
  await page.getByRole('dialog', { name: 'Comment', exact: true }).getByRole('button', { name: 'Rose comment color', exact: true }).click();
  expect((await comments(page))[0].color).toBe('rose');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await comments(page))[0].color).toBe('blue');

  // Zoomed far out, pins collapse to icons.
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Zoom out story', exact: true }).click();
  expect(Number(await page.locator('.story-scroll').getAttribute('data-zoom'))).toBeLessThan(.5);
  for (const pin of await pins(page).all()) {
    await expect(pin).toHaveAttribute('data-labelled', 'false');
    await expect.poll(async () => (await pin.boundingBox())!.width).toBeLessThanOrEqual(21);
  }
});
