import { test, expect, openVideo, addDraft, fitAll, readProject, saveAndReopen } from './fixtures';

test('video creation and new versions use H3 and expose prompt enhancement', async ({ page }) => {
  await page.route('**/api/status', async route => {
    const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { openai: true, comfy: true, fal: false, gemini: false } } });
  });
  await page.route('**/api/comfy/status*', route => route.fulfill({ json: { ready: true } }));
  let submissions = 0, falSubmissions = 0;
  await page.route('**/api/library-generations', route => { falSubmissions++; return route.fulfill({ status: 500 }); });
  await page.route('**/api/interstitials/enhance-prompt', route => route.fulfill({ json: { prompt: 'A continuous H3 shot of ocean waves.', model: 'test' } }));
  await page.route('**/api/comfy/interstitials', route => { submissions++; return route.fulfill({ status: 202, json: { requestId: 'h3_creation_123', status: 'IN_QUEUE', insertion: { start: 0, duration: 4, totalDuration: 4 } } }); });
  await page.route('**/api/comfy/jobs/h3_creation_123', route => route.fulfill({ json: { requestId: 'h3_creation_123', status: 'COMPLETED', videoUrl: 'https://example.test/h3.mp4' } }));
  await page.route('**/api/comfy/jobs/h3_creation_123/events', route => route.fulfill({ contentType: 'text/event-stream', body: '' }));
  await page.route('https://example.test/h3.mp4', route => route.fulfill({ contentType: 'video/mp4', path: 'tests/fixtures/interstitial-reference.mp4' }));
  await openVideo(page);
  await expect(page.getByRole('button', { name: 'Add Kling video', exact: true })).toHaveCount(0);
  await expect(page.getByText('Video · Kling', { exact: true })).toHaveCount(0);
  await addDraft(page); await expect(page.getByLabel('Video prompt', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Generation model', { exact: true })).toHaveCount(0);
  const before = await readProject(page), source = before.storyFlow.nodes[0];
  await fitAll(page);
  await page.locator(`[data-node-id="${source.id}"] .story-clip-title`).click();
  await page.getByRole('button', { name: 'Generate a new version', exact: true }).click();
  const enhance = page.getByRole('button', { name: 'Enhance prompt', exact: true });
  await expect(enhance).toBeDisabled(); await expect(enhance).toHaveAttribute('title', 'Enter a draft prompt to enhance.');
  await page.getByLabel('Video prompt', { exact: true }).fill('Ocean waves'); await expect(enhance).toBeEnabled();
  const converted = await readProject(page), node = converted.storyFlow.nodes.find((n: any) => n.id === source.id);
  expect(node.source).toEqual(source.source); expect(node.interstitialId).toBeTruthy(); expect(node.generationId).toBeUndefined();
  expect(converted.clipGenerations ?? []).toHaveLength(0);
  await enhance.click(); await expect(page.getByLabel('Video prompt', { exact: true })).toHaveValue('A continuous H3 shot of ocean waves.');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect.poll(async () => (await readProject(page)).interstitials.find((i: any) => i.id === node.interstitialId).phase).toBe('ready');
  expect(submissions).toBe(1); expect(falSubmissions).toBe(0);
  const ready = await readProject(page);
  expect(ready.library.some((a: any) => a.assetId === source.source.assetId)).toBe(true);
  expect(ready.storyFlow.nodes.find((n: any) => n.id === source.id).source).toBeUndefined();
});

test('legacy Kling clips retain saved media and can switch their recipe to H3', async ({ page }) => {
  await openVideo(page);
  await page.evaluate(async () => {
    const { readActiveProject, writeProject } = await import('/src/features/project/database.ts' as string);
    const { newAssetGeneration } = await import('/shared/asset-generation.ts' as string);
    const project = await readActiveProject(), generation = newAssetGeneration('image');
    generation.kind = 'video'; generation.settings.model = 'kling-video'; generation.settings.prompt = 'Saved ocean waves'; generation.phase = 'ready';
    generation.selectedAssetId = project.source.assetId; generation.versions = [{ assetId: project.source.assetId, name: 'Saved Kling output', createdAt: 1, settings: structuredClone(generation.settings) }];
    project.library = project.library.map((a: any) => a.assetId === project.source.assetId ? { ...a, generation: { provider: 'fal', settings: generation.settings, createdAt: 1 } } : a);
    project.storyFlow.nodes[0] = { ...project.storyFlow.nodes[0], generationId: generation.id, mediaKind: 'video', duration: 5 };
    await writeProject({ ...project, id: `project:${crypto.randomUUID()}`, saved: true, clipGenerations: [generation] });
  });
  await page.reload(); await page.getByRole('region', { name: 'Recent projects' }).getByRole('button', { name: 'Open', exact: true }).first().click();
  await page.locator('.story-clip-title').click();
  const before = await readProject(page);
  await expect(page.getByRole('button', { name: 'Generate video', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Use H3', exact: true }).click();
  await expect(page.getByLabel('Video prompt', { exact: true })).toHaveValue('Saved ocean waves');
  const after = await readProject(page);
  expect(after.storyFlow.nodes[0].source).toEqual(before.storyFlow.nodes[0].source);
  expect(after.library).toEqual(before.library); expect(after.clipGenerations).toHaveLength(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.getByRole('button', { name: 'Use H3', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(page.getByLabel('Video prompt', { exact: true })).toHaveValue('Saved ocean waves');
  await saveAndReopen(page);
  expect((await readProject(page)).library.find((a: any) => a.generation?.provider === 'fal').generation.settings.model).toBe('kling-video');
});
