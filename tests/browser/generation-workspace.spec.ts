import { test, expect, openVideo, addBridge, readProject, saveAndReopen } from './fixtures';

for (const width of [1440, 390]) test(`generation edits stay in the full-screen timeline at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let submissions = 0; await page.route('**/api/comfy/interstitials', route => { submissions++; return route.abort(); });
  await openVideo(page); await addBridge(page);
  const overview = page.locator('.generation-timeline-summary');
  await expect(overview).toBeVisible();
  expect((await overview.boundingBox())!.height).toBeLessThan(160);
  await expect(page.getByRole('button', { name: 'Add image keyframe', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Keyframe frame', { exact: true })).toHaveCount(0);
  await overview.click();
  const editor = page.getByRole('dialog', { name: 'Generation timeline', exact: true });
  await expect(editor).toBeVisible();
  expect((await editor.boundingBox())!.width).toBe(width);
  await expect(editor.getByRole('button', { name: 'Input', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.getByRole('button', { name: 'Generated', exact: true })).toBeDisabled();
  await editor.getByRole('checkbox', { name: 'Reference start video', exact: true }).uncheck();
  await expect.poll(async () => (await readProject(page)).interstitials[0].useInputReference).toBe(false);
  await editor.getByRole('checkbox', { name: 'Reference start video', exact: true }).check();
  await editor.getByRole('button', { name: 'Add image keyframe', exact: true }).click();
  await editor.getByLabel('Upload Keyframe image', { exact: true }).setInputFiles('src/app/tutorial/images/save.png');
  await expect(editor.getByRole('group', { name: 'Keyframe image', exact: true })).toHaveAttribute('aria-busy', 'false');
  await editor.getByLabel('Keyframe method', { exact: true }).selectOption('frame');
  await editor.getByLabel('Keyframe frame', { exact: true }).fill('87');
  await editor.getByLabel('Keyframe frame', { exact: true }).press('Enter');
  await expect.poll(async () => (await readProject(page)).interstitials[0].keyframes[0]).toMatchObject({ frame: 48, method: 'frame' });
  await editor.getByRole('button', { name: 'Select image keyframe 1', exact: true }).click();
  await expect(editor.locator('.generation-player-screen img')).toBeVisible();
  await editor.getByRole('button', { name: 'Add video', exact: true }).click();
  await editor.getByLabel('Upload Timeline video', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(editor.getByRole('group', { name: 'Timeline video', exact: true })).toHaveAttribute('aria-busy', 'false');
  await editor.getByLabel('Video source out', { exact: true }).fill('1');
  await expect.poll(async () => (await readProject(page)).interstitials[0].timelineVideos[0].video.outFrame).toBe(24);
  await editor.getByRole('button', { name: 'Edit audio mask', exact: true }).click();
  await expect(editor.locator('.mask-graph-editor')).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await editor.getByRole('button', { name: 'References', exact: true }).click();
  await expect(editor.getByRole('group', { name: 'Image references', exact: true })).toBeHidden();
  await editor.locator('.generation-image-references > summary').click();
  await editor.getByLabel('Choose image references', { exact: true }).setInputFiles('src/app/tutorial/images/save.png');
  await expect(editor.getByLabel('Enable Picture 1', { exact: true })).toBeVisible();
  await editor.getByLabel('Enable Picture 1', { exact: true }).uncheck();
  await expect.poll(async () => (await readProject(page)).interstitials[0].imageReferences[0].enabled).toBe(false);
  await editor.locator('.generation-image-references > summary').click();
  await expect(editor.getByLabel('Enable Picture 1', { exact: true })).toBeHidden();
  expect(await editor.locator('.generation-timeline-editor').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await editor.locator('.generation-timeline-editor').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: `test-results/generation-workspace-${width}.png` });
  await editor.getByRole('button', { name: 'Close generation timeline', exact: true }).click();
  await expect(page.getByLabel('Keyframe method', { exact: true })).toHaveCount(0);
  await saveAndReopen(page);
  expect((await readProject(page)).interstitials[0]).toMatchObject({ keyframes: [{ method: 'frame' }], timelineVideos: [{ video: { outFrame: 24 } }], imageReferences: [{ enabled: false }] });
  expect(errors).toEqual([]); expect(submissions).toBe(0);
});

test('prepares and submits a full input movie with videos, both keyframe methods and independent audio', async ({ page }) => {
  await openVideo(page); await addBridge(page);
  await page.getByRole('button', { name: 'Expand generation timeline', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Generation timeline', exact: true });
  await editor.getByRole('button', { name: 'Add image keyframe', exact: true }).click();
  await editor.getByLabel('Upload Keyframe image', { exact: true }).setInputFiles('src/app/tutorial/images/save.png');
  await expect(editor.getByRole('group', { name: 'Keyframe image', exact: true })).toHaveAttribute('aria-busy', 'false');
  await page.route('**/api/comfy/status*', route => route.fulfill({ json: { ready: true } }));
  let submitted: FormData | undefined;
  await page.route('**/api/comfy/interstitials', async route => {
    const request = route.request();
    submitted = await new Request(request.url(), { method: 'POST', headers: request.headers(), body: Uint8Array.from(request.postDataBuffer()!) }).formData();
    await route.fulfill({ status: 202, json: { requestId: 'test-timeline-job', status: 'IN_QUEUE' } });
  });
  const job = await page.evaluate(async () => {
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    const { generateInterstitial } = await import('/src/features/interstitials/api.ts' as string);
    const project = await readActiveProject(), item = project.interstitials[0], image = item.keyframes[0].image;
    return generateInterstitial({ ...item, prompt: 'A simple scene', method: 'comfy-extend', useInputReference: false, useOutputReference: false, duration: 3,
      keyframes: [{ id: 'guide', frame: 10, enabled: true, method: 'guide', image }, { id: 'preserved', frame: 50, enabled: true, method: 'frame', image }],
      timelineVideos: [{ id: 'input', frame: 24, enabled: true, video: { assetId: project.source.assetId, name: 'Video', inFrame: 0, outFrame: 24 } }],
    }, null, null, new AbortController().signal, () => {});
  });
  expect(job.requestId).toBe('test-timeline-job');
  expect(submitted!.get('fullInput')).toBe('true');
  expect(JSON.parse(String(submitted!.get('timelineInputs')))).toEqual([{ frame: 24, frames: 24 }]);
  expect(JSON.parse(String(submitted!.get('keyframes')))).toEqual([{ frame: 10, imageIndex: 0, method: 'guide' }, { frame: 50, imageIndex: 1, method: 'frame' }]);
  const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(submitted!.get('video') as Blob), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    expect(video).toBeTruthy(); expect(await input.getPrimaryAudioTrack()).toBeTruthy();
    expect(await video!.computeDuration()).toBeCloseTo(73 / 24, 3);
    expect((await video!.computePacketStats()).averagePacketRate).toBeCloseTo(24, 3);
  } finally { input.dispose(); }
});

test('the player switches between input footage and the saved generated result on one playhead', async ({ page }) => {
  await openVideo(page); await addBridge(page);
  const { bytes, nodeId } = await page.evaluate(async () => {
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    const { packProject } = await import('/src/features/project/archive.ts' as string);
    const project = await readActiveProject(), item = project.interstitials[0], media = await readAsset(project.source.assetId);
    item.phase = 'ready'; item.result = { assetId: media.id, url: 'asset:' + media.id, start: 0, duration: 4, totalDuration: 4 };
    const archive = await packProject(project, [media], new AbortController().signal, () => {});
    return { bytes: [...new Uint8Array(await archive.arrayBuffer())], nodeId: project.storyFlow.nodes.find((n: any) => n.interstitialId === item.id).id };
  });
  await page.getByLabel('Choose project file', { exact: true }).setInputFiles({ name: 'Generated preview.sparko', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await page.locator(`[data-node-id="${nodeId}"] .story-clip-title`).click();
  await page.getByRole('button', { name: 'Expand generation timeline', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Generation timeline', exact: true });
  const slider = editor.getByRole('slider', { name: 'Generation timeline playhead', exact: true });
  await slider.focus(); await slider.press('Home'); await slider.press('ArrowRight');
  await expect(editor.locator('.generation-player-screen video')).toBeVisible();
  await editor.getByRole('button', { name: 'Generated', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Generated', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(slider).toHaveValue('1');
  await editor.getByRole('button', { name: 'Play timeline', exact: true }).click();
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(5);
  await editor.getByRole('button', { name: 'Pause timeline', exact: true }).click();
  const frame = await slider.inputValue();
  await editor.getByRole('button', { name: 'Input', exact: true }).click();
  await expect(slider).toHaveValue(frame);
});
