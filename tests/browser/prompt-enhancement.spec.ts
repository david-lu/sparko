import { expect, test } from './fixtures';

const original = 'She asks, "What is 2 + 2?", and waits.';
const enhanced = 'In the same continuous shot, she gently asks, "What is 2 + 2?", and pauses. Preserve her position, pose, scale, background and framing. No position snaps or camera changes. All dialogue is in English.';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/status', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), providers: { openai: true, gemini: false, fal: true, comfy: true } } });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Add regular interstitial/ })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('5');
  await page.getByRole('button', { name: /^Add regular interstitial/ }).click();
  await page.getByLabel('Interstitial prompt').fill(original);
});

test('enhances with visual references, stays editable, and supports undo, redo and persistence', async ({ page }) => {
  let finish!: () => void, generations = 0;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/interstitials', route => { generations++; return route.fulfill({ status: 500, json: { error: 'Unexpected generation' } }); });
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
  const prompt = page.getByLabel('Interstitial prompt');
  await expect(prompt).toHaveValue(enhanced);
  await expect(prompt).toBeEditable();
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(prompt).toHaveValue(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(prompt).toHaveValue(enhanced);
  expect(generations).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/enhance-prompt-mobile.png' });
  await page.reload();
  await page.getByRole('button', { name: 'Select Untitled', exact: true }).click();
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
  const prompt = page.getByLabel('Interstitial prompt');
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Prompt enhancement could not reach OpenAI. Try again.');
  await expect(prompt).toHaveValue(original);
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await prompt.fill('My newer draft');
  await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeEnabled();
  finish();
  await expect(prompt).toHaveValue('My newer draft');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
