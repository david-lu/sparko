import { test, expect, openVideo, fitAll, saveAndReopen } from './fixtures';

for (const width of [1440, 390]) test(`selection highlights draft and saved reference ranges without shifting the timeline at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { bytes, draftId, readyId } = await page.evaluate(async () => {
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    const { packProject } = await import('/src/features/project/archive.ts' as string);
    const { createNode, edge } = await import('/src/features/story-flow/model.ts' as string);
    const { storyDependency } = await import('/src/features/story-flow/dependencies.ts' as string);
    const project = await readActiveProject(), original = project.storyFlow.nodes[0], media = await readAsset(project.source.assetId);
    const canvas = new OffscreenCanvas(320, 180), context = canvas.getContext('2d')!;
    context.fillStyle = '#52775e'; context.fillRect(0, 0, 320, 180);
    const still = { id: crypto.randomUUID(), name: 'Reference still.png', blob: await canvas.convertToBlob({ type: 'image/png' }) };
    const rendered = { ...media, id: crypto.randomUUID(), name: 'Saved generation.mp4' };
    const source = (id: string, x: number, start: number) => ({ ...original, id, name: id, x, y: 60, source: { ...original.source, inFrame: start, outFrame: start + 48 } });
    const a = source('Earlier video', 0, 0), b = { ...source('Previous still', 100, 0), source: { kind: 'image', assetId: still.id, inFrame: 0, outFrame: 48 } };
    const c = source('Following video', 360, 0), d = source('Later video', 460, 48);
    const draft = createNode('simple'), ready = createNode('simple');
    Object.assign(draft.node, { name: 'Draft generation', x: 200, y: 60 }); Object.assign(draft.item, { label: draft.node.name, duration: 4, start_range: 3, end_range: 3, startReferenceType: 'video', endReferenceType: 'video' });
    Object.assign(ready.node, { name: 'Saved generation', x: 232, y: 180 }); Object.assign(ready.item, { ...draft.item, id: ready.item.id, label: ready.node.name });
    project.storyFlow = { version: 1, entryId: a.id, nodes: [a, b, draft.node, c, d, ready.node], templates: [], edges: [edge(a.id, b.id), edge(b.id, draft.node.id), edge(draft.node.id, c.id), edge(c.id, d.id)] };
    project.interstitials = [draft.item, ready.item];
    const reference = storyDependency(project.storyFlow, project.interstitials, project.source.assetId, 4, draft.item.id).reference;
    ready.item.phase = 'ready'; ready.item.result = { url: `asset:${rendered.id}`, assetId: rendered.id, start: 1, duration: 2, totalDuration: 4, reference };
    project.library.push({ assetId: still.id, name: still.name, kind: 'image' }, { assetId: rendered.id, name: ready.item.label, kind: 'generated', duration: 4 });
    const archive = await packProject(project, [media, still, rendered], new AbortController().signal, () => {});
    return { bytes: [...new Uint8Array(await archive.arrayBuffer())], draftId: draft.node.id, readyId: ready.node.id };
  });
  await page.getByLabel('Choose project file', { exact: true }).setInputFiles({ name: 'References.sparko', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await expect(page.locator('.story-clip')).toHaveCount(6); await fitAll(page);
  await expect(page.locator('.story-reference-section')).toHaveCount(0);
  const clip = (id: string) => page.locator(`[data-node-id="${id}"]`);
  const ranges = () => page.locator('.story-reference-highlight').evaluateAll(nodes => nodes.map(node => ({
    clip: node.closest('.story-clip')!.getAttribute('data-node-id'), side: node.getAttribute('data-side'),
    start: Number(node.getAttribute('data-media-start')), end: Number(node.getAttribute('data-media-end')),
  })));
  const positions = () => page.locator('.story-clip,.story-toolbar').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  const before = await positions();
  await clip(draftId).locator('.story-clip-title').click();
  await expect.poll(ranges).toEqual([
    { clip: 'Earlier video', side: 'start', start: 1, end: 2 }, { clip: 'Previous still', side: 'start', start: 0, end: 2 },
    { clip: 'Following video', side: 'end', start: 0, end: 2 }, { clip: 'Later video', side: 'end', start: 2, end: 3 },
  ]);
  expect(await positions()).toEqual(before);
  await expect(clip('Earlier video').getByRole('img', { name: 'Start reference for Draft generation: 1.000–2.000 seconds', exact: true })).toBeVisible();
  await page.locator('.story-canvas').screenshot({ path: `test-results/reference-draft-${width}.png` });
  await page.getByLabel('start_range', { exact: true }).fill('1');
  await expect(clip('Earlier video').locator('.story-reference-highlight')).toHaveCount(0);
  await expect(clip('Previous still').locator('.story-reference-highlight')).toHaveAttribute('data-media-start', '1');
  await clip(readyId).locator('.story-clip-title').click();
  const savedRanges = [
    { clip: 'Previous still', side: 'start', start: 1, end: 2 }, { clip: 'Following video', side: 'end', start: 0, end: 1 },
  ];
  await expect.poll(ranges).toEqual(savedRanges);
  await expect(clip(readyId).locator('.story-reference-section')).toHaveCount(2);
  await page.getByLabel('start_range', { exact: true }).fill('4');
  await expect.poll(ranges).toEqual(savedRanges);
  await page.locator('.story-canvas').screenshot({ path: `test-results/reference-saved-${width}.png` });
  // The overlays must let pointer scrubbing through and disappear when the source is selected.
  await clip('Following video').locator('.story-filmstrip').click({ position: { x: 4, y: 35 } });
  await expect(clip('Following video')).toHaveClass(/selected/); await expect(page.locator('.story-reference-highlight')).toHaveCount(0);
  await expect(page.locator('.story-reference-section')).toHaveCount(0);
  await page.getByRole('button', { name: 'Library asset Saved generation', exact: true }).click();
  await expect.poll(ranges).toEqual(savedRanges);
  await expect(clip(readyId).locator('.story-reference-section')).toHaveCount(2);
  await saveAndReopen(page); await fitAll(page);
  await expect(page.locator('.story-reference-section')).toHaveCount(0);
  await clip(readyId).locator('.story-clip-title').click(); await expect.poll(ranges).toEqual(savedRanges);
  expect(errors).toEqual([]);
});
