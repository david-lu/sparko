import { test, expect, type Page } from '@playwright/test';

async function openDraft(page: Page) {
  await page.route('**/__draft-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Draft fixture</title>' }));
  await page.goto('/__draft-fixture');
  const bytes = await page.evaluate(async () => {
    const { Output, BufferTarget, Mp4OutputFormat, CanvasSource } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const canvas = new OffscreenCanvas(160, 96), ctx = canvas.getContext('2d')!;
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 100_000 });
    output.addVideoTrack(video, { frameRate: 24 }); await output.start();
    for (let frame = 0; frame < 480; frame++) { ctx.fillStyle = `rgb(${frame % 255}, 80, 120)`; ctx.fillRect(0, 0, 160, 96); await video.add(frame / 24, 1 / 24); }
    video.close(); await output.finalize(); return [...new Uint8Array(output.target.buffer)];
  });
  await page.route('**/media/episode_mock.mp4', route => route.fulfill({ contentType: 'video/mp4', body: Buffer.from(bytes) }));
  await page.route('**/api/status', route => route.fulfill({ json: { uploadMode: 'local', requiresPassword: false,
    providers: { openai: false, gemini: false, fal: false, comfy: true }, models: {},
    defaultVideo: { name: 'episode_mock.mp4', url: '/media/episode_mock.mp4' } } }));
  await page.route('**/api/comfy/status', route => route.fulfill({ json: { ready: true } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Add interstitial/ })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('3');
  await page.getByRole('button', { name: /^Add interstitial/ }).click();
  await expect(page.getByLabel('Video generation method')).toHaveValue('comfy');
  await page.getByLabel('Interstitial prompt').fill('Keep the same room and character.');
  await page.getByLabel('Interstitial type').selectOption('call-response');
  await expect(page.getByLabel('Interstitial prompt')).toHaveCount(4);
  await expect(page.locator('.project-status')).toHaveCount(0);
  return Buffer.from(bytes);
}
const saved = (page: Page) => page.evaluate(async () => {
  const { readActiveProject } = await import('/src/features/project/database.ts' as string);
  return readActiveProject();
});

test('editable Comfy drafts preserve both pin types, multiple groups, undo and reload', async ({ page }) => {
  await openDraft(page);
  const clips = page.locator('.clip-subpanel');
  await expect(clips).toHaveCount(4);
  await expect(page.getByLabel('Button 1 text')).toHaveValue('A');
  await expect(page.getByLabel('Button 2 text')).toHaveValue('B');
  await expect(clips.nth(0).getByLabel('Video generation method')).toHaveValue('comfy-extend');
  await expect(clips.nth(1).getByLabel('Video generation method')).toHaveValue('comfy-loop');
  await expect(clips.nth(2).getByLabel('Video generation method')).toHaveValue('comfy');
  await expect(page.locator('.timeline-flow-clip.draft')).toHaveCount(4);
  await clips.nth(0).getByLabel('Interstitial prompt').fill('Ask gently, then settle into the listening pose.');
  await page.getByLabel('Continuity brief').fill('The same character in the same room, steady camera.');
  await page.getByLabel('Question', { exact: true }).fill('Should we continue?');
  await expect(page.getByLabel('Clip dialogue')).toHaveCount(0);
  await expect(page.getByLabel('Clip type', { exact: true })).toHaveCount(0);
  await expect(clips.nth(0).getByLabel('Interstitial prompt')).toHaveValue('Ask gently, then settle into the listening pose.');
  await page.getByLabel('Interstitial type').selectOption('regular');
  await expect(page.getByLabel('Interstitial prompt')).toHaveCount(1);
  await expect(page.getByLabel('Interstitial prompt')).toHaveValue('Keep the same room and character.');
  await page.getByLabel('Interstitial type').selectOption('call-response');
  await expect(clips.nth(0).getByLabel('Interstitial prompt')).toHaveValue('Ask gently, then settle into the listening pose.');
  const continuation = page.locator('[data-scene-id="source:1"] .flow-clip-body');
  const bounds = await continuation.boundingBox();
  await continuation.click({ position: { x: bounds!.width / 3, y: bounds!.height / 2 } });
  await page.getByRole('button', { name: /^Add interstitial/ }).click();
  await expect(page.getByLabel('Interstitial type')).toHaveValue('regular');
  await page.getByLabel('Interstitial type').selectOption('call-response');
  await expect(page.locator('.timeline-interstitial-group')).toHaveCount(2);
  await expect(page.locator('.timeline-flow-clip.draft')).toHaveCount(8);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.timeline-interstitial-group')).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.timeline-interstitial-group')).toHaveCount(2);
  await expect.poll(async () => (await saved(page)).callResponses.length).toBe(2);
  await page.getByLabel('Question', { exact: true }).fill('Where should we go next?');
  await page.getByLabel('Question', { exact: true }).press('Tab');
  for (const [index, question] of ['Should we continue?', 'Where should we go next?'].entries()) {
    const idle = page.locator('.timeline-interstitial-group').nth(index).locator('[data-clip-kind="idle"] .flow-clip-body');
    await idle.focus(); await page.keyboard.press('Enter');
    await expect(page.locator('.player-branch-question')).toHaveText(question);
    await expect(page.getByRole('group', { name: 'Choose an answer' })).toHaveAccessibleDescription(question);
  }
  await page.reload();
  await expect(page.locator('.timeline-interstitial-group')).toHaveCount(2);
  await page.locator('.timeline-pin').first().click();
  await expect(clips.nth(0).getByLabel('Interstitial prompt')).toHaveValue('Ask gently, then settle into the listening pose.');
  await expect(page.getByLabel('Question', { exact: true })).toHaveValue('Should we continue?');
  await expect(page.locator('.buffering')).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: 'test-results/call-response-draft.png' });
});

test('Comfy generates in dependency order with live edits, individual regeneration and cancellation', async ({ page }) => {
  const bytes = await openDraft(page), submissions: { mode: string; prompt: string }[] = [];
  let releaseCall = false, cancelled = false, hold = false;
  await page.route('**/api/comfy/jobs/*/events', route => route.fulfill({ contentType: 'text/event-stream', body: 'event: fallback\ndata: {}\n\n' }));
  await page.route('**/api/comfy/interstitials', async route => {
    const form = await new Response(Uint8Array.from(route.request().postDataBuffer()!), { headers: { 'Content-Type': route.request().headers()['content-type'] } }).formData();
    submissions.push({ mode: String(form.get('mode')), prompt: String(form.get('prompt')) });
    const { comfyBridgePlan } = await import('../../shared/comfy');
    const plan = comfyBridgePlan(Number(form.get('before')), Number(form.get('after')), Number(form.get('duration')), form.get('mode') as 'extend' | 'loop' | 'bridge');
    await route.fulfill({ status: 202, json: { requestId: `comfy-job-${submissions.length}`, status: 'IN_QUEUE', insertion: plan.insertion } });
  });
  await page.route('**/api/comfy/jobs/*', route => {
    const id = route.request().url().split('/').at(-1)!;
    if (route.request().method() === 'DELETE') { cancelled = true; return route.fulfill({ json: { requestId: id, status: 'CANCELLED' } }); }
    return route.fulfill({ json: { requestId: id, status: hold || id === 'comfy-job-1' && !releaseCall ? 'IN_PROGRESS' : 'COMPLETED', videoUrl: `/api/comfy/assets/${id}/content` } });
  });
  await page.route('**/api/comfy/assets/*/content', route => route.fulfill({ contentType: 'video/mp4', body: bytes }));
  const clips = page.locator('.clip-subpanel');
  await page.getByRole('button', { name: 'Generate all sequentially', exact: true }).click();
  await expect.poll(() => submissions.length, { timeout: 30_000 }).toBe(1);
  expect(submissions[0].mode).toBe('extend');
  for (const editor of await clips.getByLabel('Interstitial prompt').all()) await expect(editor).toBeEditable();
  await clips.nth(0).getByLabel('Interstitial prompt').fill('A later Call edit.');
  await clips.nth(1).getByLabel('Interstitial prompt').fill('Wait quietly, returning to the same pose.');
  releaseCall = true;
  await expect(page.getByRole('status').filter({ hasText: 'All 4 clips generated.' })).toBeVisible({ timeout: 60_000 });
  expect(submissions.map(item => item.mode)).toEqual(['extend', 'loop', 'bridge', 'bridge']);
  expect(submissions[1].prompt).toContain('Wait quietly, returning to the same pose.');
  expect(submissions[0].prompt).not.toContain('A later Call edit.');
  const project = await saved(page), children = project.interstitials.filter((item: any) => item.groupId);
  expect(children.every((item: any) => item.phase === 'ready' && item.result.assetId)).toBe(true);
  const idle = children.find((item: any) => item.method === 'comfy-loop');
  expect(idle.result.start).toBe(0);
  expect(idle.result.reference.before.assetId).toBe(children.find((item: any) => item.method === 'comfy-extend').result.assetId);
  expect(children.filter((item: any) => item.method === 'comfy').every((item: any) => item.result.reference.before.assetId === idle.result.assetId)).toBe(true);
  await expect(page.locator('.timeline-flow-clip.draft')).toHaveCount(0);
  await expect(page.locator('.timeline-flow-clip[data-stale=true]')).toHaveCount(0);
  await clips.nth(2).getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect.poll(() => submissions.length, { timeout: 30_000 }).toBe(5);
  await expect(clips.nth(2).getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled({ timeout: 30_000 });
  hold = true;
  await page.getByRole('button', { name: 'Generate all sequentially', exact: true }).click();
  await expect.poll(() => submissions.length, { timeout: 30_000 }).toBe(6);
  await page.getByRole('button', { name: 'Cancel sequence', exact: true }).click();
  await expect.poll(() => cancelled).toBe(true);
  await expect(page.getByRole('button', { name: 'Continue sequence', exact: true })).toBeVisible();
  expect(submissions).toHaveLength(6);
  await expect(page.locator('.timeline-flow-clip.draft')).toHaveCount(0);
  await expect(page.locator('.timeline-flow-clip[data-stale=true]')).toHaveCount(0);
  hold = false;
  await clips.nth(0).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => submissions.length, { timeout: 30_000 }).toBe(7);
  await expect(clips.nth(0).getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('.timeline-flow-clip[data-stale=true]')).toHaveCount(3);
  await expect(page.locator('.timeline-flow-clip.clip-call')).toHaveAttribute('data-stale', 'false');
  await expect(page.locator('.timeline-flow-clip.clip-idle .flow-clip-stale')).toBeVisible();
  const labelBounds = await page.locator('.timeline-flow-clip.clip-idle .timeline-clip-label').boundingBox();
  const staleBounds = await page.locator('.timeline-flow-clip.clip-idle .flow-clip-stale').boundingBox();
  expect(staleBounds!.y).toBeGreaterThanOrEqual(labelBounds!.y + labelBounds!.height);
  await page.reload();
  await expect(page.locator('.timeline-flow-clip[data-stale=true]')).toHaveCount(3);
  await expect(page.locator('.buffering')).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: 'test-results/call-response-stale.png' });
});
