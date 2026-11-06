import { test, expect, openVideo, fitAll, type Page } from './fixtures';

async function openTransitions(page: Page, branch = false) {
  await openVideo(page);
  const ids = await page.evaluate(async branch => {
    const { readActiveProject, readAsset, writeProject } = await import('/src/features/project/database.ts' as string);
    const { createNode, edge } = await import('/src/features/story-flow/model.ts' as string);
    const original = await readActiveProject(), asset = await readAsset(original.source.assetId);
    const { node, item } = createNode('simple'), renderId = crypto.randomUUID();
    Object.assign(node, { name: 'Imported scene', x: 260, y: 90 });
    Object.assign(item, { label: node.name, phase: 'ready', result: { assetId: renderId, url: `asset:${renderId}`, start: 1, duration: 2, totalDuration: 4,
      reference: { mode: 'custom', before: { sceneId: 'before', assetId: crypto.randomUUID(), inFrame: 0, outFrame: 48 } } } });
    const before = { id: 'before', name: 'Before', kind: 'source', x: 40, y: 90, loopCount: 0, source: { assetId: asset.id, duration: 4, inFrame: 0, outFrame: 48 } };
    const after = { ...before, id: 'after', name: 'Parent video', x: 480, source: { ...before.source, inFrame: 48, outFrame: 96 } };
    const incoming = { ...edge(before.id, node.id), videoCrossfade: .5, audioCrossfade: .75 };
    const outgoing = { ...edge(node.id, after.id), videoCrossfade: .5, audioCrossfade: .75 };
    const alternate = { ...before, id: 'alternate', name: 'Alternate', x: 480, y: 220 };
    const alternateEdge = { ...edge(node.id, alternate.id), videoCrossfade: .5, audioCrossfade: .75 };
    await writeProject({ ...original, id: `project:${crypto.randomUUID()}`, name: 'Transition sample', saved: true, interstitials: [item],
      storyFlow: { version: 1, entryId: before.id, nodes: [before, node, after, ...branch ? [alternate] : []], edges: [incoming, outgoing, ...branch ? [alternateEdge] : []], templates: [] } },
      [{ ...asset, id: renderId, name: 'Imported scene.mp4' }]);
    return { node: node.id, incoming: incoming.id, outgoing: outgoing.id, alternate: alternateEdge.id };
  }, branch);
  await page.reload();
  await page.getByRole('region', { name: 'Recent projects' }).getByRole('button', { name: 'Open', exact: true }).first().click();
  await expect(page.locator('.story-clip')).toHaveCount(branch ? 4 : 3);
  await expect(page.locator('.story-transition-region')).toHaveCount(0);
  await fitAll(page);
  return ids;
}

for (const width of [1440, 390]) test(`transition regions match playback, connection colors, and independent channel edits at ${width}px`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 1000 });
  const ids = await openTransitions(page);
  const clip = page.locator(`[data-node-id="${ids.node}"]`);
  const regions = clip.locator('.story-transition-region');
  const exit = page.locator(`.story-edge[data-edge-id="${ids.outgoing}"]`);
  const layout = async () => ({ height: (await clip.boundingBox())!.height, toolbar: await page.locator('.story-toolbar').evaluate(el => {
    const r = el.getBoundingClientRect(), parent = el.closest('.story-canvas')!.getBoundingClientRect();
    return { y: r.y-parent.y, height: r.height, width: r.width };
  }) });
  const before = await layout();
  const geometry = [];
  // Wires remain selectable at every zoom, including overviews that hide fade buttons.
  for (const id of [ids.incoming, ids.outgoing]) {
    await page.locator(`.story-edge[data-edge-id="${id}"] .story-edge-hit`).press('Enter');
    await expect(regions).toHaveCount(2);
    geometry.push(...await regions.evaluateAll(nodes => nodes.map(node => {
      const span = node as HTMLElement, parent = span.parentElement!.getBoundingClientRect(), rect = span.getBoundingClientRect();
      const edge = document.querySelector(`.story-edge[data-edge-id="${span.dataset.edgeId}"] .story-edge-line`)!;
      return { channel: span.dataset.channel, start: Number(span.dataset.mediaStart), end: Number(span.dataset.mediaEnd),
        left: (rect.left-parent.left)/parent.width, width: rect.width/parent.width,
        color: getComputedStyle(span).color, lineColor: getComputedStyle(edge).stroke };
    })));
  }
  for (const region of geometry) {
    expect(region.color).toBe(region.lineColor);
    expect(region.left).toBeCloseTo(region.start/4, 2);
    expect(region.width).toBeCloseTo((region.end-region.start)/4, 2);
  }
  expect(geometry.filter(r => r.channel === 'video').map(r => [r.start, r.end])).toEqual([[.5, 1], [3, 3.5]]);
  expect(geometry.filter(r => r.channel === 'audio').map(r => [r.start, r.end])).toEqual([[.25, 1], [3, 3.75]]);
  const entry = page.locator(`.story-edge[data-edge-id="${ids.incoming}"]`);
  await expect(entry).toHaveAttribute('data-reference-state', 'mismatch');
  await entry.locator('.story-edge-hit').press('Enter');
  await expect(page.locator('.story-transition-region')).toHaveCount(4);
  await expect(page.locator(`.story-transition-region.selected[data-edge-id="${ids.incoming}"]`)).toHaveCount(4);
  await expect(page.getByLabel('Video crossfade timing')).toContainText('0.500 s dissolve');
  await expect(page.getByLabel('Reference matching')).toContainText('Configured crossfades still apply');
  await exit.locator('.story-edge-hit').press('Enter');
  await expect(page.locator(`.story-transition-region.selected[data-edge-id="${ids.outgoing}"]`)).toHaveCount(4);
  await expect(page.getByLabel('Video crossfade timing')).toContainText('0.500 s dissolve');
  await expect(page.getByLabel('Audio crossfade timing')).toContainText('0.750 s fade');
  const video = clip.locator(`.story-transition-region[data-edge-id="${ids.outgoing}"][data-channel="video"]`);
  expect(await video.evaluate(el => getComputedStyle(el).color)).toBe(await exit.locator('.story-edge-line').evaluate(el => getComputedStyle(el).stroke));
  await page.getByLabel('Video crossfade duration', { exact: true }).fill('0');
  await expect(page.locator(`.story-transition-region[data-edge-id="${ids.outgoing}"][data-channel="video"]`)).toHaveCount(0);
  await expect(page.locator(`.story-transition-region[data-edge-id="${ids.outgoing}"][data-channel="audio"]`)).toHaveCount(2);
  await page.getByLabel('Video crossfade duration', { exact: true }).fill('0.5');
  await expect(video).toHaveCount(1);
  // Overlays remain part of the scrub surface rather than intercepting pointer edits.
  await clip.locator(`.story-transition-region[data-edge-id="${ids.outgoing}"][data-channel="audio"]`).click();
  await expect(clip).toHaveClass(/playing/);
  await expect(page.locator('.story-transition-region')).toHaveCount(0);
  expect(await layout()).toEqual(before);
  await fitAll(page);
  await page.screenshot({ path: `test-results/transition-regions-${width}.png`, fullPage: true });
  expect(errors).toEqual([]);
});

for (const width of [1440, 390]) test(`selecting a branch transition highlights both clips without squeezing its video and audio lanes at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const ids = await openTransitions(page, true);
  const positions = () => page.locator('.story-clip').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  const before = await positions();
  for (const [edgeId, destination] of [[ids.outgoing, 'after'], [ids.alternate, 'alternate']]) {
    const edge = page.locator(`.story-edge[data-edge-id="${edgeId}"]`);
    await edge.locator('.story-edge-hit').press('Enter');
    await expect(edge).toHaveClass(/selected/);
    const regions = page.locator('.story-transition-region');
    await expect(regions).toHaveCount(4);
    for (const nodeId of [ids.node, destination]) {
      const clip = page.locator(`[data-node-id="${nodeId}"]`);
      const spans = clip.locator('.story-transition-region.selected');
      await expect(spans).toHaveCount(2);
      for (const span of await spans.all()) {
        await expect(span).toHaveAttribute('data-edge-id', edgeId);
        await expect(span).toBeVisible();
        const geometry = await span.evaluate(el => {
          const r = el.getBoundingClientRect(), strip = el.parentElement!.getBoundingClientRect(), css = getComputedStyle(el);
          // Ports sit over the center of very narrow fades; the upper edge must stay visible above the thumbnails.
          const top = document.elementFromPoint(r.x + r.width/2, r.y + Math.min(4, r.height/4));
          return { height: r.height/strip.height, top: (r.top-strip.top)/strip.height, color: css.color,
            border: css.borderTopWidth, visibleOnTop: el === top || el.contains(top) };
        });
        expect(geometry.height).toBeCloseTo(.5, 2);
        expect(geometry.top).toBeCloseTo(await span.getAttribute('data-channel') === 'video' ? 0 : .5, 2);
        expect(geometry.color).toBe(await edge.locator('.story-edge-line').evaluate(el => getComputedStyle(el).stroke));
        expect(geometry.border).toBe('2px'); expect(geometry.visibleOnTop).toBe(true);
      }
    }
    expect(await positions()).toEqual(before);
  }
  await page.locator('.story-canvas').screenshot({ path: `test-results/selected-transition-${width}.png` });
  await page.locator(`[data-node-id="${ids.node}"] .story-clip-title`).click();
  await expect(page.locator('.story-transition-region')).toHaveCount(0);
  await page.locator(`.story-edge[data-edge-id="${ids.alternate}"] .story-edge-hit`).press('Enter');
  await expect(page.locator('.story-transition-region')).toHaveCount(4);
  await fitAll(page);
  await expect(page.locator('.story-transition-region')).toHaveCount(0);
});
