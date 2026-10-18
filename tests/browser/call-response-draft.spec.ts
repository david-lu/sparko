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
  await page.route('**/media/sample.mp4', route => route.fulfill({ contentType: 'video/mp4', body: Buffer.from(bytes) }));
  await page.route('**/api/status', route => route.fulfill({ json: { uploadMode: 'local', requiresPassword: false,
    providers: { openai: false, gemini: false, comfy: true }, models: {},
    defaultVideo: { name: 'sample.mp4', url: '/media/sample.mp4' } } }));
  await page.route('**/api/comfy/status', route => route.fulfill({ json: { ready: true } }));
  await page.goto('/');
  await page.getByRole('button', { name: /Sample video/ }).click();
  await expect(page.getByRole('button', { name: 'Add call-response interstitial' })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('3');
  await page.getByRole('button', { name: 'Add call-response interstitial' }).click();
  await expect(page.getByLabel('Interstitial prompt')).toHaveCount(4);
  await expect(page.locator('.project-status')).toHaveCount(0);
  return Buffer.from(bytes);
}
const saved = (page: Page) => page.evaluate(async () => {
  const { readActiveProject } = await import('/src/features/project/database.ts' as string);
  return readActiveProject();
});

test('creation uses separate fixed types and call-response drafts stay off the timeline', async ({ page }) => {
  await openDraft(page);
  const clips = page.locator('.clip-subpanel');
  await expect(clips).toHaveCount(4);
  await expect(clips.locator('.clip-status-badge')).toHaveText(['Draft', 'Draft', 'Draft', 'Draft']);
  await expect(clips.locator('.clip-status-badge svg')).toHaveCount(4);
  await page.setViewportSize({ width: 390, height: 844 });
  await clips.first().locator('.clip-status-badge').scrollIntoViewIfNeeded();
  await expect(clips.first().locator('.clip-status-badge')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByLabel('Button 1 text')).toHaveValue('A');
  await expect(page.getByLabel('Button 2 text')).toHaveValue('B');
  await expect(clips.nth(0).getByLabel('Video generation method')).toHaveValue('comfy-extend');
  await expect(clips.nth(1).getByLabel('Video generation method')).toHaveValue('comfy-loop');
  await expect(clips.nth(1).getByLabel('Include generated loop audio')).toHaveCount(0);
  await expect(clips.nth(2).getByLabel('Video generation method')).toHaveValue('comfy');
  await expect(page.locator('.timeline-flow-clip')).toHaveCount(0);
  await expect(page.locator('.timeline-interstitial-group')).toHaveCount(0);
  await expect(page.locator('.timeline-section .source-entire')).toBeVisible();
  await expect(page.locator('.timeline-actions').getByRole('button', { name: /Add interstitial/ })).toHaveCount(0);
  await expect(page.getByLabel('Interstitial type')).toHaveCount(0);
  await clips.nth(0).getByLabel('Interstitial prompt').fill('Ask gently, then settle into the listening pose.');
  await page.getByLabel('Continuity brief').fill('The same character in the same room, steady camera.');
  await page.getByLabel('Question', { exact: true }).fill('Should we continue?');
  await expect(page.getByLabel('Clip dialogue')).toHaveCount(0);
  await expect(page.getByLabel('Clip type', { exact: true })).toHaveCount(0);
  await expect(clips.nth(0).getByLabel('Interstitial prompt')).toHaveValue('Ask gently, then settle into the listening pose.');
  await page.getByRole('button', { name: 'All interstitials' }).click();
  await expect(page.getByRole('button', { name: 'Add regular interstitial' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add call-response interstitial' })).toBeVisible();
  await expect(page.locator('.interstitial-clips .clip-status-badge')).toHaveText(['Draft', 'Draft', 'Draft', 'Draft']);
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('8');
  await page.getByRole('button', { name: 'Add call-response interstitial' }).click();
  await expect.poll(async () => (await saved(page)).callResponses.length).toBe(2);
  await expect(page.locator('.timeline-flow-clip')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await saved(page)).callResponses.length).toBe(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await saved(page)).callResponses.length).toBe(2);
  await page.getByRole('button', { name: 'All interstitials' }).click();
  await page.getByRole('button', { name: 'Add regular interstitial' }).click();
  await expect(page.getByLabel('Interstitial type')).toHaveCount(0);
  await expect(page.locator('.timeline-pin')).toHaveCount(1);
  expect((await saved(page)).interstitials.filter((item: { groupId?: string; kind?: string }) => !item.groupId && item.kind !== 'call-response')).toHaveLength(1);
});

test('Comfy generates in dependency order with live edits, individual regeneration and cancellation', async ({ page }) => {
  const bytes = await openDraft(page), submissions: { mode: string; prompt: string }[] = [];
  let releaseCall = false, releaseIdle = false, releaseResponses = false, cancelled = false, hold = false;
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
    const waiting = hold || id === 'comfy-job-1' && !releaseCall || id === 'comfy-job-2' && !releaseIdle || id === 'comfy-job-3' && !releaseResponses;
    return route.fulfill({ json: { requestId: id, status: waiting ? 'IN_PROGRESS' : 'COMPLETED', videoUrl: `/api/comfy/assets/${id}/content` } });
  });
  await page.route('**/api/comfy/assets/*/content', route => route.fulfill({ contentType: 'video/mp4', body: bytes }));
  const clips = page.locator('.clip-subpanel');
  await page.getByRole('button', { name: 'Generate all sequentially', exact: true }).click();
  await expect.poll(() => submissions.length, { timeout: 30_000 }).toBe(1);
  await expect(clips.nth(0)).toHaveAttribute('data-status', 'generating');
  await expect(clips.nth(1)).toHaveAttribute('data-status', 'waiting');
  expect(submissions[0].mode).toBe('extend');
  for (const editor of await clips.getByLabel('Interstitial prompt').all()) await expect(editor).toBeEditable();
  await clips.nth(0).getByLabel('Interstitial prompt').fill('A later Call edit.');
  await clips.nth(1).getByLabel('Interstitial prompt').fill('Wait quietly, returning to the same pose.');
  releaseCall = true;
  await expect.poll(() => submissions.length, { timeout: 30_000 }).toBe(2);
  await expect(clips.nth(0).locator('.clip-status-badge')).toHaveText('Video ready');
  await expect(clips.nth(1)).toHaveAttribute('data-status', 'generating');
  const finishedClips = page.locator('.timeline-interstitial-group .timeline-flow-clip:not(.draft)');
  await expect(finishedClips).toHaveCount(1);
  await expect(page.locator('.timeline-interstitial-group .timeline-flow-clip')).toHaveCount(1);
  await expect(page.locator('.timeline-flow-clip.draft')).toHaveCount(0);
  const callClip = page.locator('.timeline-flow-clip.clip-call');
  await expect(callClip).toBeVisible();
  await callClip.locator('.flow-clip-body').focus(); await page.keyboard.press('Enter');
  await expect(callClip).toHaveAttribute('data-active', 'true');
  await page.locator('.video-stage').hover();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => callClip.locator('.flow-playhead').evaluate(element => parseFloat((element as HTMLElement).style.left))).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  releaseIdle = true;
  await expect.poll(() => submissions.length, { timeout: 30_000 }).toBe(3);
  await expect(finishedClips).toHaveCount(2);
  await expect(page.locator('.timeline-interstitial-group .timeline-flow-clip')).toHaveCount(2);
  await expect(page.locator('.timeline-flow-clip.clip-idle')).not.toHaveClass(/\bdraft\b/);
  await expect(clips.nth(1).locator('.interstitial-preview video')).toHaveJSProperty('muted', true);
  releaseResponses = true;
  await expect(page.getByRole('status').filter({ hasText: 'All 4 clips generated.' })).toBeVisible({ timeout: 60_000 });
  await expect(clips.locator('.clip-status-badge')).toHaveText(['Video ready', 'Video ready', 'Video ready', 'Video ready']);
  await expect(page.locator('.timeline-interstitial-group .timeline-flow-clip')).toHaveCount(4);
  expect(submissions.map(item => item.mode)).toEqual(['extend', 'loop', 'bridge', 'bridge']);
  expect(submissions[1].prompt).toContain('Wait quietly, returning to the same pose.');
  expect(submissions[0].prompt).not.toContain('A later Call edit.');
  await expect.poll(async () => (await saved(page)).interstitials.filter((item: any) => item.groupId && item.phase === 'ready' && item.result?.assetId).length).toBe(4);
  const project = await saved(page), children = project.interstitials.filter((item: any) => item.groupId);
  expect(children.every((item: any) => item.phase === 'ready' && item.result.assetId)).toBe(true);
  const idle = children.find((item: any) => item.method === 'comfy-loop');
  expect(idle.result.start).toBe(0);
  expect(idle.result.fullAssetId).toBeTruthy();
  expect(idle.result.fullRange.start).toBeGreaterThan(0);
  expect(idle.result.fullRange.totalDuration - idle.result.fullRange.start - idle.result.fullRange.duration).toBeGreaterThan(0);
  const idleClip = page.locator('.timeline-flow-clip.clip-idle');
  const idleBody = (await idleClip.locator('.flow-clip-body').boundingBox())!;
  const idleBefore = (await idleClip.locator('.timeline-reference-range.before').boundingBox())!;
  const idleAfter = (await idleClip.locator('.timeline-reference-range.after').boundingBox())!;
  expect(idleBefore.x + idleBefore.width).toBeCloseTo(idleBody.x, 1);
  expect(idleAfter.x).toBeCloseTo(idleBody.x + idleBody.width, 1);
  await expect(idleClip.locator('.flow-clip-body')).toHaveAttribute('title', /Generated .* · Full file .* · Dotted sections:/);
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
  await page.getByRole('button', { name: 'Add answer', exact: true }).click();
  await expect(finishedClips).toHaveCount(4);
  await expect(page.locator('.timeline-interstitial-group .timeline-flow-clip')).toHaveCount(4);
  await expect(page.locator('.timeline-flow-clip.draft')).toHaveCount(0);
});

test('reopening a partially generated project keeps its finished clip on the timeline', async ({ page }) => {
  await openDraft(page);
  await page.evaluate(async () => {
    const { readActiveProject, writeProject } = await import('/src/features/project/database.ts' as string);
    const project = await readActiveProject(), group = project.callResponses[0];
    const callId = group.scenes.find((scene: { id: string }) => scene.id === 'call').interstitialId;
    const idleId = group.scenes.find((scene: { id: string }) => scene.id === 'wait').interstitialId;
    await writeProject({ ...project, saved: true, name: 'Partial Call Response', interstitials: project.interstitials.map((item: { id: string }) =>
      item.id === callId ? { ...item, phase: 'ready', result: { assetId: project.source.assetId, url: `asset:${project.source.assetId}`, start: 0, duration: 6, totalDuration: 20 } }
        : item.id === idleId ? { ...item, phase: 'error', error: 'Generation failed' } : item) });
  });
  await page.reload();
  const recent = page.getByRole('region', { name: 'Recent projects' }).locator('.project-start-row').filter({ hasText: 'Partial Call Response' });
  await recent.getByRole('button', { name: 'Open', exact: true }).click();
  const list = page.locator('.interstitial-clips');
  await expect(list.locator('.clip-status-badge')).toHaveText(['Video ready', 'Failed', 'Draft', 'Draft']);
  const colors = await list.locator('.interstitial-row').evaluateAll(rows => rows.slice(0, 2).map(row => getComputedStyle(row).borderLeftColor));
  expect(colors[0]).not.toBe(colors[1]);
  await list.getByRole('button', { name: /Select Idle clip/ }).click();
  await expect(page.locator('.clip-subpanel').nth(1)).toHaveAttribute('data-status', 'failed');
  await expect(page.locator('.timeline-flow-clip.clip-call')).toBeVisible();
  await expect(page.locator('.timeline-flow-clip.clip-call')).not.toHaveClass(/\bdraft\b/);
  await expect(page.locator('.timeline-interstitial-group .timeline-flow-clip')).toHaveCount(1);
  await expect(page.locator('.timeline-flow-clip.draft')).toHaveCount(0);
});
