import { expect, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    uploadMode: 'local', requiresPassword: false, providers: { openai: true, gemini: false, fal: true, comfy: true },
    models: {}, defaultVideo: { name: 'sample.mp4', url: '/media/sample.mp4', size: 0 },
  } }));
  await page.goto('/');
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.getByRole('button', { name: 'Add call-response interstitial', exact: true })).toBeEnabled();
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('2');
  await page.getByRole('button', { name: 'Add call-response interstitial', exact: true }).click();
  await expect(page.locator('.clip-subpanel')).toHaveCount(4);
});

test('every Call, Idle and Response prompt has its own working enhancer, including newly added answers', async ({ page }) => {
  const kinds: string[] = [];
  let generations = 0;
  await page.route('**/api/comfy/interstitials', route => { generations++; return route.fulfill({ status: 500, json: { error: 'Unexpected generation' } }); });
  await page.route('**/api/interstitials/enhance-prompt', route => {
    const body = route.request().postDataJSON();
    kinds.push(body.kind);
    expect(body.target).toBeUndefined();
    expect(body.continuity).toBeTruthy();
    expect(body.referenceFrames.length).toBeGreaterThan(0);
    return route.fulfill({ json: { prompt: `Enhanced ${body.kind} ${kinds.length}`, model: 'test' } });
  });
  await page.getByRole('button', { name: 'Add answer', exact: true }).click();
  const clips = page.locator('.clip-subpanel');
  await expect(clips).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toHaveCount(6);
  for (let index = 0; index < 5; index++) {
    const prompt = clips.nth(index).getByLabel('Interstitial prompt');
    const button = clips.nth(index).getByRole('button', { name: 'Enhance prompt', exact: true });
    await expect(button).toHaveAttribute('aria-controls', (await prompt.getAttribute('id'))!);
    await button.click();
    await expect(prompt).toHaveValue(`Enhanced ${['call', 'idle', 'response', 'response', 'response'][index]} ${index + 1}`);
  }
  expect(kinds).toEqual(['call', 'idle', 'response', 'response', 'response']);
  expect(generations).toBe(0);
});

test('continuity enhancement preserves concurrent edits, updates every clip, and supports undo and redo', async ({ page }) => {
  let finish!: () => void, requests = 0;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const enhanced = 'Keep the same character, voice, clothing and room with a steady camera and continuous movement.';
  const brief = page.getByLabel('Continuity brief', { exact: true });
  const original = await brief.inputValue();
  const editor = page.locator('.continuity-brief-editor');
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    const body = route.request().postDataJSON(); requests++;
    expect(body).toMatchObject({ prompt: original, target: 'continuity' });
    expect(body.referenceFrames).toHaveLength(2);
    await waiting;
    await route.fulfill({ json: { prompt: enhanced, model: 'test' } });
  });
  await editor.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(editor.getByRole('button', { name: 'Enhancing…', exact: true })).toBeDisabled();
  await page.getByLabel('Question', { exact: true }).fill('Where should we go?');
  await page.getByLabel('Question', { exact: true }).press('Tab');
  finish();
  await expect(brief).toHaveValue(enhanced);
  await expect(page.getByLabel('Question', { exact: true })).toHaveValue('Where should we go?');
  await expect.poll(async () => page.evaluate(async () => {
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    return (await readActiveProject()).interstitials.filter((item: { groupId?: string }) => item.groupId).map((item: { continuity?: string }) => item.continuity);
  })).toEqual(Array(4).fill(enhanced));
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(brief).toHaveValue(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(brief).toHaveValue(enhanced);
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.getByRole('button', { name: 'Enhance prompt', exact: true }).scrollIntoViewIfNeeded();
  await expect(editor.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('continuity failures, cancellation and late responses preserve the current draft', async ({ page }) => {
  let requests = 0, finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    requests++;
    if (requests === 1) return route.fulfill({ status: 502, json: { error: 'Enhancement failed. Try again.' } });
    await waiting;
    await route.fulfill({ json: { prompt: 'A late result', model: 'test' } }).catch(() => undefined);
  });
  const editor = page.locator('.continuity-brief-editor'), brief = page.getByLabel('Continuity brief', { exact: true });
  const enhance = editor.getByRole('button', { name: 'Enhance prompt', exact: true });
  const original = await brief.inputValue();
  await enhance.click();
  await expect(editor.getByRole('alert')).toHaveText('Enhancement failed. Try again.');
  await expect(brief).toHaveValue(original);
  await enhance.click();
  await expect.poll(() => requests).toBe(2);
  await editor.getByRole('button', { name: 'Cancel prompt enhancement' }).click();
  await expect(enhance).toBeEnabled();
  await expect(brief).toHaveValue(original);
  await enhance.click();
  await expect.poll(() => requests).toBe(3);
  await brief.fill('My newer continuity brief');
  finish();
  await expect(enhance).toBeEnabled();
  await expect(brief).toHaveValue('My newer continuity brief');
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await brief.fill('');
  await expect(enhance).toBeDisabled();
});
