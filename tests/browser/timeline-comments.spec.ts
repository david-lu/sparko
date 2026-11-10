import { test, expect, readProject, type Page } from './fixtures';

const open = async (page: Page) => {
  await page.goto('/'); await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled();
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.story-clip')).toHaveCount(1);
};
const layout = (page: Page) => Promise.all(['.story-toolbar', '.story-scroll', '.story-status', '.video-stage'].map(selector => page.locator(selector).boundingBox()));
const comments = async (page: Page) => (await readProject(page)).storyFlow.comments ?? [];
const status = (page: Page) => page.locator('.story-status [role="status"]');

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
  await expect(pin).toBeFocused();
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
  const moved = (await page.locator('.story-comment-pin').boundingBox())!;
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
  await expect(page.locator('.story-comment-pin')).toHaveCount(2);
  expect((await comments(page))[0].anchor).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.story-clip')).toHaveCount(1);
  expect((await comments(page))[0].anchor).toEqual(saved.anchor);

  // Arrow keys nudge a pin by a frame; Delete removes the focused pin.
  const title = page.getByRole('button', { name: /^Comment on .+: Add a title card here$/ });
  await title.focus(); await page.keyboard.press('Delete');
  await expect(page.locator('.story-comment-pin')).toHaveCount(1);
  const remaining = page.locator('.story-comment-pin'); await remaining.focus(); await page.keyboard.press('ArrowRight');
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
  await expect(page.locator('.story-comment-pin')).toHaveCount(1);
  expect(await layout(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
