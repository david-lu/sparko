import { test, expect, openVideo, addDraft, readProject, saveAndReopen, fitAll, type Page } from './fixtures';

async function openBranches(page: Page) {
  await openVideo(page);
  const bytes = await page.evaluate(async () => {
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    const { packProject } = await import('/src/features/project/archive.ts' as string);
    const project = await readActiveProject(), source = project.storyFlow.nodes[0];
    const nodes = [
      { id: 'intro', name: 'Introduction', x: 0, y: 140, color: 'blue' },
      { id: 'question', name: 'Question', x: 340, y: 140, color: 'purple', loop: true, conditional: true,
        conditions: [{ id: 'green', label: 'Green', values: [] }, { id: 'pink', label: 'Pink', values: [] }] },
      { id: 'green-clip', name: 'Green reaction', x: 620, y: 0, color: 'green' },
      { id: 'pink-clip', name: 'Pink reaction', x: 620, y: 280, color: 'rose' },
      { id: 'end', name: 'Ending', x: 960, y: 140, color: 'amber' },
    ].map(n => ({ ...source, ...n }));
    const edges = [['intro', 'question'], ['question', 'green-clip'], ['question', 'pink-clip'], ['green-clip', 'end'], ['pink-clip', 'end']].map(([from, to], index) => ({
      id: `edge-${index}`, from, to, event: from === 'question' ? 'answer' : 'next',
      conditionId: from === 'question' ? index === 1 ? 'green' : 'pink' : undefined, label: 'Next', values: [],
    }));
    project.storyFlow = { version: 1, entryId: 'intro', nodes, edges, templates: [], groups: [{ id: 'question-group', name: 'Question & response', color: 'purple', nodeIds: ['question', 'green-clip', 'pink-clip'] }] };
    const blob = await packProject(project, [await readAsset(project.source.assetId)], new AbortController().signal, () => {});
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.getByLabel('Choose project file', { exact: true }).setInputFiles({ name: 'Branches.sparko', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await expect(page.locator('.story-clip')).toHaveCount(5);
  await fitAll(page);
}

for (const width of [1440, 390]) test(`zoomed-out clips stay contained and fades only appear with room at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await openBranches(page);
  const canvas = page.locator('.story-scroll');
  // Fit can start below icon detail on narrow viewports with non-overlay scrollbars.
  while (Number(await canvas.getAttribute('data-zoom')) < .25) await page.getByRole('button', { name: 'Zoom in story' }).click();
  while (Number(await canvas.getAttribute('data-zoom')) > .25) await page.getByRole('button', { name: 'Zoom out story' }).click();
  const graph = (await readProject(page)).storyFlow;
  await expect(page.locator('.story-clip[data-detail=icon]')).toHaveCount(5);
  await expect(page.locator('.story-crossfade')).toHaveCount(0);
  await expect(page.locator('.conditional-output>span').first()).toBeHidden();
  await expect(page.locator('.story-clip-title small').first()).toBeHidden();
  await expect(page.locator('.story-clip-type').first()).toBeVisible();
  expect(await page.locator('.story-clip').evaluateAll(clips => clips.every(clip => {
    const bounds = clip.getBoundingClientRect(), title = clip.querySelector('.story-clip-title')!.getBoundingClientRect();
    const sockets = [...clip.querySelectorAll('.story-port')].filter(el => !el.classList.contains('conditional-output'));
    return bounds.height === 76 && title.left >= bounds.left && title.right <= bounds.right + .1
      && sockets.every(el => el.getBoundingClientRect().width < 7);
  }))).toBe(true);
  await canvas.screenshot({ path: `test-results/clip-appearance-overview-${width}.png` });
  while (Number(await canvas.getAttribute('data-zoom')) > .08) await page.getByRole('button', { name: 'Zoom out story' }).click();
  await expect(page.locator('.story-clip[data-detail=minimal]')).toHaveCount(5);
  await expect(page.locator('.story-clip-type').first()).toBeHidden();
  expect(await page.locator('.story-clip-title').evaluateAll(titles => titles.every(title => {
    const r = title.getBoundingClientRect(), clip = title.parentElement!.getBoundingClientRect();
    return r.left >= clip.left && r.right <= clip.right;
  }))).toBe(true);
  await page.locator('.story-edge-hit').first().press('Enter');
  await expect(page.getByLabel('Video crossfade duration', { exact: true })).toBeVisible();
  await expect(page.locator('.story-crossfade')).toHaveCount(0);
  while (Number(await canvas.getAttribute('data-zoom')) < 1) await page.getByRole('button', { name: 'Zoom in story' }).click();
  expect(await page.locator('.story-crossfade').count()).toBeGreaterThan(0);
  expect(await page.locator('.story-scroll').evaluate(el => {
    const clips = [...el.querySelectorAll('.story-clip')].map(n => n.getBoundingClientRect());
    return [...el.querySelectorAll('.story-crossfade')].every(n => {
      const r = n.getBoundingClientRect();
      return clips.every(c => r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom);
    });
  })).toBe(true);
  expect((await readProject(page)).storyFlow).toEqual(graph);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  await canvas.screenshot({ path: `test-results/clip-appearance-detail-${width}.png` });
});

test('clip colors apply to a selection, undo together, persist and leave type icons intact', async ({ page }) => {
  await openVideo(page);
  await page.locator('.story-clip-title').click();
  await page.getByRole('button', { name: 'Rose clip color', exact: true }).click();
  await expect(page.locator('.story-clip')).toHaveAttribute('data-color', 'rose');
  await expect(page.locator('.story-clip-type')).toHaveAttribute('aria-label', 'Source video');
  await page.locator('.story-filmstrip').press('Home');
  await page.locator('.story-filmstrip').press('Shift+ArrowRight');
  await page.locator('.story-filmstrip').press('s');
  await expect(page.locator('.story-clip[data-color=rose]')).toHaveCount(2);
  await fitAll(page);
  await page.locator('.story-clip-title').first().click();
  await page.locator('.story-clip-title').last().click({ modifiers: ['Shift'] });
  await page.locator('.story-clip-title').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Clip color', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Blue', exact: true }).click();
  await expect(page.locator('.story-clip[data-color=blue]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.story-clip[data-color=rose]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.story-clip[data-color=blue]')).toHaveCount(2);
  await page.locator('.story-clip-title').last().click();
  await page.getByRole('button', { name: 'Duplicate clip', exact: true }).click();
  await expect(page.locator('.story-clip[data-color=blue]')).toHaveCount(4);
  await saveAndReopen(page);
  await expect(page.locator('.story-clip[data-color=blue]')).toHaveCount(4);
  await page.locator('.story-clip-title').first().click();
  await expect(page.getByRole('button', { name: 'Blue clip color', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

for (const width of [1440, 390]) test(`compact clip layout stays stable through generation, failure and recovery at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/api/status', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), providers: { comfy: true, openai: false, gemini: false } } });
  });
  await page.route('**/api/comfy/status*', route => route.fulfill({ json: { ready: true } }));
  let fail = false, complete = false;
  await page.route('**/api/comfy/interstitials', route => route.fulfill({ status: 202, json: { requestId: 'appearance-job', status: 'IN_QUEUE', insertion: { start: 0, duration: 4, totalDuration: 4 } } }));
  await page.route('**/api/comfy/jobs/appearance-job/events', route => route.fulfill({ contentType: 'text/event-stream', body: 'event: progress\ndata: {"type":"progress","progressDetails":{"stage":"Generating video"}}\n\n' }));
  await page.route('**/api/comfy/jobs/appearance-job', route => route.fulfill(fail ? { status: 500, json: { error: 'Test generation failed' } } : { json: complete
    ? { requestId: 'appearance-job', status: 'COMPLETED', videoUrl: 'https://example.test/appearance.mp4' }
    : { requestId: 'appearance-job', status: 'IN_PROGRESS' } }));
  await page.route('https://example.test/appearance.mp4', route => route.fulfill({ contentType: 'video/mp4', path: 'tests/fixtures/interstitial-reference.mp4' }));
  await page.goto('/'); await page.getByRole('button', { name: /^New project/ }).click(); await addDraft(page);
  await page.getByLabel('Video prompt', { exact: true }).fill('Clouds drift across a sunset sky.');
  await page.getByLabel('Duration', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Purple clip color', exact: true }).click();
  while (Number(await page.locator('.story-scroll').getAttribute('data-zoom')) > .3) await page.getByRole('button', { name: 'Zoom out story' }).click();
  const dimensions = () => page.locator('.story-canvas').evaluate(root => {
    const bounds = root.getBoundingClientRect();
    return ['.story-toolbar', '.story-status', '.story-clip', '.story-clip-title', '.story-filmstrip'].map(selector => {
      const r = root.querySelector(selector)!.getBoundingClientRect();
      return { x: r.x - bounds.x, y: r.y - bounds.y, width: r.width, height: r.height };
    });
  });
  const idle = await dimensions();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.locator('.story-clip .clip-job-status')).toBeVisible();
  expect(await dimensions()).toEqual(idle);
  fail = true;
  await expect(page.locator('.task-status')).toContainText('Test generation failed');
  expect(await dimensions()).toEqual(idle);
  fail = false; complete = true;
  await page.getByRole('button', { name: 'Check result', exact: true }).click();
  await expect.poll(async () => (await readProject(page)).interstitials[0].phase).toBe('ready');
  await expect(page.locator('.story-clip .video-filmstrip img').first()).toBeVisible();
  expect(await dimensions()).toEqual(idle);
  await expect(page.locator('.story-clip')).toHaveAttribute('data-color', 'purple');
  await expect(page.locator('.story-clip-type')).toHaveAttribute('aria-label', 'Generated video');
});
