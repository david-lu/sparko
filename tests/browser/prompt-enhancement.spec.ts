import { expect, test, openVideo, addBridge, saveAndReopen } from './fixtures';

const original = 'She asks, "What is 2 + 2?", and waits.';
const enhanced = 'In the same continuous shot, she gently asks, "What is 2 + 2?", and pauses. Preserve her position, pose, scale, background and framing. No position snaps or camera changes. All dialogue is in English.';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/status', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), providers: { openai: true, gemini: false, comfy: true } } });
  });
  await openVideo(page);
  await addBridge(page);
  await page.getByRole('group', { name: 'End reference', exact: true }).getByRole('button', { name: 'Video', exact: true }).click();
  await page.getByLabel('Video prompt').fill(original);
});

test('enhances with visual references, stays editable, and supports undo, redo and persistence', async ({ page }) => {
  let finish!: () => void, generations = 0;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/comfy/interstitials', route => { generations++; return route.fulfill({ status: 500, json: { error: 'Unexpected generation' } }); });
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ prompt: original, duration: 6, kind: 'interstitial' });
    expect(body.referenceFrames).toHaveLength(2);
    for (const frame of body.referenceFrames) expect(frame).toMatch(/^data:image\/jpeg;base64,/);
    await waiting;
    await route.fulfill({ json: { prompt: enhanced, model: 'test-model' } });
  });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enhancing…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel prompt enhancement' })).toBeVisible();
  finish();
  const prompt = page.getByLabel('Video prompt');
  await expect(prompt).toHaveValue(enhanced);
  await expect(prompt).toBeEditable();
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(prompt).toHaveValue(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(prompt).toHaveValue(enhanced);
  expect(generations).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/enhance-prompt-mobile.png' });
  await saveAndReopen(page);
  await page.locator('.story-clip.type-simple .story-clip-title').click();
  await expect(prompt).toHaveValue(enhanced);
});

test('preserves the draft on errors and ignores a late result after the user edits it', async ({ page }) => {
  let requests = 0, finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    requests++;
    if (requests === 1) return route.fulfill({ status: 502, json: { error: 'Prompt enhancement could not reach OpenAI. Try again.' } });
    await waiting;
    await route.fulfill({ json: { prompt: enhanced, model: 'test-model' } }).catch(() => undefined);
  });
  const prompt = page.getByLabel('Video prompt');
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  const toast = page.getByRole('alert').filter({ hasText: 'Video prompt enhancement failed' });
  await expect(toast).toContainText('Prompt enhancement could not reach OpenAI. Try again.');
  await expect(toast).toBeInViewport();
  await expect(page.locator('.task-status')).not.toContainText('could not reach');
  await expect(prompt).toHaveValue(original);
  await toast.getByRole('button', { name: 'Dismiss notification', exact: true }).press('Enter');
  await expect(toast).toHaveCount(0);
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await prompt.fill('My newer draft');
  await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeEnabled();
  finish();
  await expect(prompt).toHaveValue('My newer draft');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.task-status')).not.toContainText('could not reach');
});

for (const width of [1440, 390]) test(`keeps the multi-line draft and layout stable when timing does not fit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const draft = 'She holds a rock and asks "A rock?", then sets it down, lifts a bowl and asks "Old vegetables?"';
  const prompt = page.getByLabel('Video prompt');
  await prompt.fill(draft);
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    expect(route.request().postDataJSON().prompt).toBe(draft);
    await waiting;
    await route.fulfill({ status: 422, json: { error: 'This sequence needs about 9 seconds for its dialogue and actions. Increase the duration or split it into shorter clips, then enhance again. Your draft has been kept.' } });
  });
  const enhance = page.getByRole('button', { name: 'Enhance prompt', exact: true });
  await enhance.scrollIntoViewIfNeeded();
  const before = await prompt.boundingBox();
  await enhance.click();
  await expect(page.getByRole('button', { name: 'Enhancing…', exact: true })).toBeDisabled();
  expect(await prompt.boundingBox()).toEqual(before);
  finish();
  await expect(page.getByRole('alert')).toContainText('Increase the duration or split it');
  await expect(prompt).toHaveValue(draft);
  await expect(enhance).toBeEnabled();
  expect(await prompt.boundingBox()).toEqual(before);
});
