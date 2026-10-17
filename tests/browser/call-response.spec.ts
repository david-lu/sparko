import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const clip = (page: Page, id: string) => page.locator(`.timeline-flow-clip[data-scene-id="${id}"]`);
const video = (page: Page) => page.locator('.video-stage > video');
const branchButton = (page: Page, outcome: 'correct' | 'incorrect') => page.locator('.video-stage').getByRole('button', { name: `Take ${outcome} branch`, exact: true });
async function selectIdle(page: Page) {
  await clip(page, 'wait').getByRole('button', { name: 'Select clip Idle · waiting for an answer', exact: true }).focus();
  await page.keyboard.press('Enter');
}
async function openExample(page: Page, prepare?: () => Promise<void>, generation = false) {
  await page.route('**/api/status', route => route.fulfill({ json: {
    uploadMode: 'local', requiresPassword: false, providers: { openai: false, gemini: false, fal: generation, comfy: false },
    models: { openai: 'mock', gemini: 'mock', fal: 'mock' },
    defaultVideo: { name: 'episode_mock.mp4', size: 0, url: '/media/episode_mock.mp4' },
  } }));
  await page.route('**/media/episode_mock.mp4', route => route.fulfill({ path: path.resolve('tests/fixtures/interstitial-reference.mp4'), contentType: 'video/mp4' }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Add draft/ })).toBeEnabled({ timeout: 60_000 });
  await video(page).evaluate(element => { (window as any).originalVideoElement = element; });
  await prepare?.();
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open test call response' }).click();
  await expect(page.locator('.timeline-section.has-flow')).toBeVisible();
  await expect(page.locator('.project-status')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('.buffering')).toHaveCount(0, { timeout: 30_000 });
}

test('the timeline shows footage and the player branches out of the idle clip', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openExample(page);
  expect(await video(page).evaluate(element => element === (window as any).originalVideoElement)).toBe(true);
  await expect(page.locator('.timeline-section')).toHaveCount(1);
  await expect(page.locator('.timeline-flow-clip')).toHaveCount(6);
  await expect(page.locator('.timeline-flow-edge')).toHaveCount(7);
  for (const id of ['intro', 'call', 'wait', 'correct', 'incorrect', 'continue']) await expect(clip(page, id).locator('.video-filmstrip img').first()).toBeVisible({ timeout: 30000 });
  const group = page.locator('.timeline-interstitial-group');
  await expect(group).toHaveCount(1);
  await expect(group).toHaveAccessibleName('Call Response Interstitial');
  await expect(group.locator('.flow-clip-type')).toHaveText(['Call', 'Idle', 'Correct Response', 'Incorrect Response']);
  await expect(group.locator('.timeline-flow-clip')).toHaveCount(4);
  await expect(clip(page, 'intro').locator('.flow-clip-type')).toHaveCount(0);
  await expect(clip(page, 'continue').locator('.flow-clip-type')).toHaveCount(0);
  await expect(clip(page, 'wait').getByRole('img', { name: 'Loops until an answer' })).toBeVisible();
  await expect(page.locator('.timeline-heading .eyebrow')).toHaveText('TIMELINE / 1 INTERSTITIAL');
  await page.getByRole('button', { name: 'All interstitials', exact: true }).click();
  await expect(page.locator('.interstitial-list > li')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Clips in Call Response Interstitial' }).getByRole('button')).toHaveCount(4);
  await page.getByRole('button', { name: 'Select Idle clip', exact: true }).click();
  await expect(page.locator('.call-response-panel h2').first()).toHaveText('Call Response Interstitial');
  await expect(page.getByRole('region', { name: 'Idle clip', exact: true }).getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible();
  await clip(page, 'intro').getByRole('button', { name: 'Select clip Source · before', exact: true }).click();
  await expect(page.locator('.flow-video-caption, .flow-video-label')).toHaveCount(0);
  await expect(page.locator('.timeline-section').getByRole('button', { name: /Take .* branch/ })).toHaveCount(0);
  await expect(branchButton(page, 'correct')).toHaveCount(0);
  await expect(clip(page, 'wait')).toHaveAttribute('data-clip-kind', 'idle');
  await clip(page, 'wait').getByRole('button', { name: 'Select clip Idle · waiting for an answer', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Clip type', exact: true })).toHaveValue('idle');
  await video(page).click({ position: { x: 20, y: 65 } });
  await expect(page.locator('[data-edge-id="wait-loop"]')).toHaveAttribute('data-traversed', 'true', { timeout: 8000 });
  await video(page).click({ position: { x: 20, y: 65 } });
  await branchButton(page, 'correct').click();
  await expect(branchButton(page, 'correct')).toHaveAttribute('aria-pressed', 'true');
  await expect(clip(page, 'correct')).toHaveAttribute('data-active', 'true', { timeout: 7000 });
  await expect(page.locator('[data-edge-id="wait-correct"]')).toHaveAttribute('data-traversed', 'true');
  await expect(page.locator('[data-edge-id="wait-incorrect"]')).toHaveAttribute('data-traversed', 'false');
  await expect(clip(page, 'continue')).toHaveAttribute('data-active', 'true', { timeout: 7000 });
  await selectIdle(page);
  await branchButton(page, 'incorrect').click();
  await expect(clip(page, 'incorrect')).toHaveAttribute('data-active', 'true', { timeout: 7000 });
  await video(page).click({ position: { x: 20, y: 65 } });
  await page.screenshot({ path: 'test-results/call-response-timeline.png' });
  expect(errors).toEqual([]);
});

test('connections persist through reload, route the real video, and the original project stays intact', async ({ page }) => {
  await openExample(page, async () => {
    await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('2');
    await page.getByRole('button', { name: /^Add draft/ }).click();
    await page.getByRole('textbox', { name: 'Interstitial prompt', exact: true }).fill('Keep the original draft.');
  });
  await clip(page, 'incorrect').getByRole('button', { name: 'Reconnect ended from Give a hint', exact: true }).click();
  await clip(page, 'wait').getByRole('button', { name: 'Connect to Idle · waiting for an answer', exact: true }).click();
  await expect(page.locator('[data-edge-id="incorrect-continue"]')).toHaveAttribute('data-to', 'wait');
  const groupId = await page.locator('.timeline-interstitial-group').getAttribute('data-interstitial-id');
  await page.reload();
  await expect(page.locator('.timeline-interstitial-group')).toHaveAttribute('data-interstitial-id', groupId!);
  await expect(page.locator('[data-edge-id="incorrect-continue"]')).toHaveAttribute('data-to', 'wait');
  await expect(page.locator('.buffering')).toHaveCount(0, { timeout: 30_000 });
  await selectIdle(page);
  await branchButton(page, 'incorrect').click();
  await expect(clip(page, 'incorrect')).toHaveAttribute('data-active', 'true', { timeout: 7000 });
  await expect(clip(page, 'wait')).toHaveAttribute('data-active', 'true', { timeout: 7000 });
  await expect(branchButton(page, 'correct')).toHaveAttribute('aria-pressed', 'false');
  await expect(branchButton(page, 'incorrect')).toHaveAttribute('aria-pressed', 'false');
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open default video' }).click();
  await expect(page.locator('.timeline-section.has-flow')).toHaveCount(0);
  await expect(page.locator('.timeline-pin')).toHaveCount(1);
  await page.locator('.timeline-pin').click();
  await expect(page.getByRole('textbox', { name: 'Interstitial prompt' })).toHaveValue('Keep the original draft.');
});

test('idle is a saved clip type and the player branch controls fit on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openExample(page);
  await clip(page, 'wait').getByRole('button', { name: 'Select clip Idle · waiting for an answer', exact: true }).click();
  await page.getByRole('combobox', { name: 'Clip type', exact: true }).selectOption('video');
  await expect(clip(page, 'wait')).toHaveAttribute('data-clip-kind', 'video');
  await expect(clip(page, 'wait').locator('.flow-clip-type')).toHaveCount(0);
  await expect(page.locator('.timeline-interstitial-group .timeline-flow-clip')).toHaveCount(3);
  await expect(branchButton(page, 'correct')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Clip type', exact: true }).selectOption('idle');
  await expect(clip(page, 'wait').getByRole('img', { name: 'Loops until an answer' })).toBeVisible();
  await expect(page.locator('.timeline-interstitial-group .timeline-flow-clip')).toHaveCount(4);
  await selectIdle(page);
  await expect(branchButton(page, 'correct')).toBeInViewport();
  await branchButton(page, 'correct').click();
  await expect(branchButton(page, 'correct')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.locator('.video-stage')).toBeVisible();
  const resize = page.getByRole('separator', { name: 'Resize timeline', exact: true });
  expect(Number(await resize.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(Number(await resize.getAttribute('aria-valuemax')));
  await page.screenshot({ path: 'test-results/call-response-timeline-mobile.png' });
});

test('clips stay capped and centered, branches touch, and response duration edits are shared and saved', async ({ page }) => {
  await openExample(page, async () => {
    await page.getByRole('separator', { name: 'Resize timeline', exact: true }).focus();
    await page.keyboard.press('End');
    const track = (await page.locator('.timeline-track').boundingBox())!;
    const space = (await page.locator('.timeline-track-space').boundingBox())!;
    expect(track.height).toBeLessThanOrEqual(76);
    expect(track.y + track.height / 2).toBeCloseTo(space.y + space.height / 2, 1);
    await expect(page.locator('.interstitial-connections')).toHaveCount(0);
  });
  const checkBranches = async () => {
    const tracks = (await page.locator('.timeline-flow-tracks').boundingBox())!;
    const idle = (await clip(page, 'wait').boundingBox())!;
    const correct = (await clip(page, 'correct').boundingBox())!;
    const incorrect = (await clip(page, 'incorrect').boundingBox())!;
    const after = (await clip(page, 'continue').boundingBox())!;
    expect(idle.height).toBeLessThanOrEqual(76);
    expect(correct.height).toBe(idle.height);
    expect(incorrect.height).toBe(idle.height);
    expect(idle.y + idle.height / 2).toBeCloseTo(tracks.y + tracks.height / 2, 1);
    expect(correct.y + correct.height).toBeCloseTo(incorrect.y, 1);
    expect(correct.y + correct.height).toBeCloseTo(idle.y + idle.height / 2, 1);
    expect(correct.x).toBeCloseTo(idle.x + idle.width, 1);
    expect(incorrect.x).toBeCloseTo(correct.x, 1);
    expect(incorrect.width).toBeCloseTo(correct.width, 1);
    expect(correct.x + correct.width).toBeCloseTo(after.x, 1);
    expect(after.y).toBeCloseTo(idle.y, 1);
  };
  await checkBranches();
  await expect(page.locator('.timeline-connections')).toHaveCount(0);
  await page.getByRole('separator', { name: 'Resize timeline', exact: true }).focus();
  await page.keyboard.press('Home');
  await checkBranches();
  await page.getByRole('slider', { name: 'Timeline zoom', exact: true }).fill('3');
  await checkBranches();
  await page.getByRole('button', { name: 'Fit timeline' }).click();
  await clip(page, 'correct').getByRole('button', { name: 'Select clip Celebrate', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Duration', exact: true }).fill('7.5');
  await clip(page, 'incorrect').getByRole('button', { name: 'Select clip Give a hint', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Duration', exact: true })).toHaveValue('7.5');
  await expect(page.getByText('Shared duration for both response branches.', { exact: false })).toBeVisible();
  await page.reload();
  await clip(page, 'correct').getByRole('button', { name: 'Select clip Celebrate', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Duration', exact: true })).toHaveValue('7.5');
  await page.mouse.move(20, 20);
  await page.screenshot({ path: 'test-results/call-response-stacked.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await checkBranches();
  await page.screenshot({ path: 'test-results/call-response-stacked-mobile.png' });
});

test('one timeline container opens child subpanels and regeneration follows the preceding clip', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let submissions = 0;
  await page.route('**/api/interstitials', async route => {
    submissions++;
    expect(route.request().postDataBuffer()!.toString('latin1')).toContain('ftyp');
    await route.fulfill({ status: 202, json: { requestId: `child-render-${submissions}`, status: 'IN_QUEUE' } });
  });
  await page.route('**/api/fal/jobs/child-render-*', route => route.fulfill({ json: {
    requestId: route.request().url().split('/').at(-1), status: 'COMPLETED', videoUrl: `https://fal.media/child-${submissions}.mp4`,
    insertion: { start: 0, duration: 4, totalDuration: 4 },
  } }));
  await page.route('https://fal.media/child-*.mp4', route => route.fulfill({ path: path.resolve('tests/fixtures/interstitial-reference.mp4'), contentType: 'video/mp4' }));
  await openExample(page, undefined, true);
  const container = page.getByRole('button', { name: 'Select entire Call Response Interstitial', exact: true });
  const parent = page.getByLabel('Call Response Interstitial panel', { exact: true });
  const child = (label: string) => parent.getByRole('region', { name: `${label} clip`, exact: true });
  await expect(container).toHaveAttribute('aria-pressed', 'true');
  await expect(parent.locator('.clip-subpanel')).toHaveCount(4);
  await expect(parent.locator('.clip-subpanel-heading[aria-expanded=true]')).toHaveCount(0);
  const bounds = (await container.boundingBox())!;
  for (const id of ['call', 'wait', 'correct', 'incorrect']) {
    const box = (await clip(page, id).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x); expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(box.y).toBeGreaterThanOrEqual(bounds.y); expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  }
  await child('Call').locator('.clip-subpanel-heading').click();
  await child('Call').getByRole('textbox', { name: 'Interstitial prompt' }).fill('An independently edited call');
  const previousTime = await video(page).evaluate(element => (element as HTMLVideoElement).currentTime);
  await container.click({ position: { x: 5, y: 5 } });
  await expect(container).toHaveAttribute('aria-pressed', 'true');
  expect(await video(page).evaluate(element => (element as HTMLVideoElement).currentTime)).toBeCloseTo(previousTime, 1);
  await child('Call').locator('.clip-subpanel-heading').click();
  await child('Call').getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(child('Call').getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled({ timeout: 30_000 });
  expect(submissions).toBe(1);
  await expect(child('Idle').locator('.clip-subpanel-heading small')).toHaveText('Needs regeneration');
  await child('Correct Response').locator('.clip-subpanel-heading').click();
  await expect(child('Correct Response').getByRole('button', { name: 'Regenerate', exact: true })).toBeDisabled();
  await expect(child('Correct Response').getByText('Regenerate Idle first to use the updated preceding clip.')).toBeVisible();
  await child('Idle').locator('.clip-subpanel-heading').click();
  await child('Idle').getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(child('Idle').getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled({ timeout: 30_000 });
  expect(submissions).toBe(2);
  await child('Correct Response').locator('.clip-subpanel-heading').click();
  await child('Correct Response').getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(child('Correct Response').getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled({ timeout: 30_000 });
  expect(submissions).toBe(3);
  await expect(child('Correct Response').locator('.clip-subpanel-heading small')).toHaveText('Ready');
  await expect(child('Incorrect Response').locator('.clip-subpanel-heading small')).toHaveText('Needs regeneration');
  await page.reload();
  await container.click({ position: { x: 5, y: 5 } });
  await expect(child('Correct Response').locator('.clip-subpanel-heading small')).toHaveText('Ready');
  await expect(child('Incorrect Response').locator('.clip-subpanel-heading small')).toHaveText('Needs regeneration');
  await child('Call').locator('.clip-subpanel-heading').click();
  await expect(child('Call').getByRole('textbox', { name: 'Interstitial prompt' })).toHaveValue('An independently edited call');
  expect(errors).toEqual([]);
});
