import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const clip = (page: Page, id: string) => page.locator(`.timeline-flow-clip[data-scene-id="${id}"]`);
const video = (page: Page) => page.locator('.video-stage > video').first();
const selectedEditor = (page: Page) => page.locator('.clip-subpanel.selected, .sidebar > .call-response-controls');
const branchButton = (page: Page, outcome: string) => page.locator('.video-stage').getByRole('button', { name: `Choose ${outcome === 'correct' ? 'A' : outcome === 'incorrect' ? 'B' : outcome}`, exact: true });
async function selectIdle(page: Page) {
  await clip(page, 'wait').getByRole('button', { name: 'Select clip Idle · waiting for an answer', exact: true }).focus();
  await page.keyboard.press('Enter');
}
async function openExample(page: Page, prepare?: () => Promise<void>, generation = false) {
  await page.route('**/api/status', route => route.fulfill({ json: {
    uploadMode: 'local', requiresPassword: false, providers: { openai: false, gemini: false, fal: generation, comfy: false },
    models: { openai: 'mock', gemini: 'mock', fal: 'mock' },
    defaultVideo: { name: 'sample.mp4', size: 0, url: '/media/sample.mp4' },
  } }));
  await page.route('**/media/sample.mp4', route => route.fulfill({ path: path.resolve('tests/fixtures/interstitial-reference.mp4'), contentType: 'video/mp4' }));
  await page.goto('/');
  await page.getByRole('button', { name: /Sample video/ }).click();
  await expect(page.getByRole('button', { name: /^Add regular interstitial/ })).toBeEnabled({ timeout: 60_000 });
  await prepare?.();
  const duration = await video(page).evaluate(element => (element as HTMLVideoElement).duration);
  await page.evaluate(async duration => {
    const { readActiveProject, writeProject } = await import('/src/features/project/database.ts' as string);
    const { createTimelineExample } = await import('/src/features/call-response/model.ts' as string);
    const current = await readActiveProject();
    const example = createTimelineExample(current.source.assetId, duration);
    await writeProject({ ...current, id: `project:${crypto.randomUUID()}`, name: 'Test call response',
      saved: true, updatedAt: Date.now(), interstitials: example.interstitials,
      callResponse: example.flow, callResponses: [example.flow], subtitle: null });
  }, duration);
  await page.reload();
  const example = page.getByRole('region', { name: 'Recent projects' }).locator('.project-start-row').filter({ hasText: 'Test call response' });
  await example.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.timeline-section.has-flow')).toBeVisible();
  await page.locator('.timeline-pin').click();
  await expect(page.locator('.project-status')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('.buffering')).toHaveCount(0, { timeout: 30_000 });
  await video(page).evaluate(element => { (window as any).originalVideoElement = element; });
}

async function reloadWorkingProject(page: Page) {
  await page.evaluate(async () => {
    const { readActiveProject, writeProject } = await import('/src/features/project/database.ts' as string);
    const current = await readActiveProject();
    await writeProject({ ...current, id: 'project:test-reload', name: 'Working test project',
      saved: true, updatedAt: Date.now() });
  });
  await page.reload();
  const working = page.getByRole('region', { name: 'Recent projects' }).locator('.project-start-row').filter({ hasText: 'Working test project' });
  await working.getByRole('button', { name: 'Open' }).click();
}

test('generated framing is optional in Options, preserves the current scene and persists on reload', async ({ page }) => {
  await openExample(page);
  await selectIdle(page);
  await expect(page.locator('.buffering')).toHaveCount(0, { timeout: 30_000 });
  const position = await clip(page, 'wait').locator('.flow-playhead').getAttribute('style');
  await page.getByText('Options', { exact: true }).click();
  const toggle = page.getByRole('menuitemcheckbox', { name: 'Match generated framing' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.buffering')).toHaveCount(0, { timeout: 30_000 });
  await expect(clip(page, 'wait')).toHaveAttribute('data-active', 'true');
  await expect(clip(page, 'wait').locator('.flow-playhead')).toHaveAttribute('style', position!);
  await expect(video(page)).toHaveJSProperty('paused', true);
  await reloadWorkingProject(page);
  await expect(page.locator('.timeline-section.has-flow')).toBeVisible();
  await page.getByText('Options', { exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.focus(); await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('sparko:match-generated-framing'))).toBe('false');
  await expect(video(page)).toHaveJSProperty('paused', true);
  await expect(page.locator('.buffering')).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: 'test-results/generated-framing-options.png' });
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`answer choices dismiss in order and survive the playback transition (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    if (reducedMotion === 'reduce') await page.setViewportSize({ width: 390, height: 844 });
    await openExample(page);
    await selectIdle(page);
    const choices = page.getByRole('group', { name: 'Choose an answer' });
    const question = choices.locator('.player-branch-question');
    await expect(question).toHaveText('What is 2 + 2?');
    await expect(question).toHaveCSS('animation-name', reducedMotion === 'reduce' ? 'none' : 'question-in');
    await expect.poll(() => choices.locator('button').evaluateAll(buttons => buttons.flatMap(button => button.getAnimations()).length)).toBe(0);
    const outcome = reducedMotion === 'reduce' ? 'incorrect' : 'correct';
    const selected = branchButton(page, outcome), other = branchButton(page, outcome === 'correct' ? 'incorrect' : 'correct');
    const before = await selected.boundingBox();
    const end = await page.evaluate(async () => {
      const { readActiveProject } = await import('/src/features/project/database.ts' as string);
      const flow = (await readActiveProject()).callResponse;
      const scene = flow.scenes.find((scene: any) => scene.id === 'wait');
      return (scene.clip.outFrame - scene.clip.inFrame) / flow.fps;
    });
    await video(page).evaluate(async (element: HTMLVideoElement, end: number) => {
      const seeked = new Promise<void>(resolve => element.addEventListener('seeked', () => resolve(), { once: true }));
      // Seek before the next idle cycle is committed to the continuous playback stream.
      element.currentTime = end - .5; await seeked;
    }, end);
    await choices.evaluate(element => {
      (window as any).choicePhases = [];
      const phases = new MutationObserver(() => (window as any).choicePhases.push({ phase: element.getAttribute('data-phase'), at: performance.now(),
        questionAnimation: getComputedStyle(element.querySelector('.player-branch-question')!).animationName }));
      phases.observe(element, { attributes: true, attributeFilter: ['data-phase'] });
      const removal = new MutationObserver(() => {
        if (element.isConnected) return;
        (window as any).choicePhases.push({ phase: 'done', at: performance.now() });
        phases.disconnect(); removal.disconnect();
      });
      removal.observe(element.parentElement!, { childList: true });
    });
    await selected.click();
    await expect(choices).toHaveAttribute('data-phase', 'holding');
    await expect(other).toBeHidden();
    await expect(question).toBeHidden();
    await expect(selected).toBeVisible();
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await expect(selected).toHaveAttribute('aria-disabled', 'true');
    await expect(selected).toHaveText(outcome === 'correct' ? 'A' : 'B');
    const stage = (await page.locator('.video-stage').boundingBox())!;
    await expect.poll(async () => { const button = (await selected.boundingBox())!; return Math.abs(button.x + button.width / 2 - stage.x - stage.width / 2); }).toBeLessThan(1);
    const centered = (await selected.boundingBox())!;
    expect(centered.width).toBeCloseTo(before!.width, 1);
    expect(Math.abs(centered.x - before!.x)).toBeGreaterThan(10);
    await page.screenshot({ path: `test-results/selected-answer-${reducedMotion}.png` });
    await expect(clip(page, outcome)).toHaveAttribute('data-active', 'true');
    await expect(selected).toBeVisible();
    await expect(choices).toHaveCount(0);
    const phases = await page.evaluate(() => (window as any).choicePhases as { phase: string; at: number; questionAnimation?: string }[]);
    expect(phases.find(event => event.phase === 'dismissing')?.questionAnimation).toBe(reducedMotion === 'reduce' ? 'none' : 'question-out');
    const holding = phases.find(event => event.phase === 'holding')!;
    const exiting = phases.find(event => event.phase === 'exiting') ?? phases.find(event => event.phase === 'done')!;
    expect(exiting.at - holding.at).toBeGreaterThanOrEqual(950);
    expect(exiting.at - holding.at).toBeLessThan(1600);
    await selectIdle(page);
    await expect(choices).toHaveAttribute('data-phase', 'choosing');
    await expect(selected).toHaveAttribute('aria-pressed', 'false');
    await expect(other).toBeVisible();
    await expect(question).toBeVisible();
  });
}

test('custom answers drive stacked clips, player buttons, undo and saved projects', async ({ page }) => {
  await openExample(page);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  const select = async (id: string) => { await clip(page, id).locator('.flow-clip-body').focus(); await page.keyboard.press('Enter'); };
  const buttons = page.getByRole('group', { name: 'Question and responses', exact: true });
  const rename = async (id: string, label: string) => {
    await select(id);
    const index = id === 'correct' ? 1 : id === 'incorrect' ? 2 : 3;
    const input = buttons.getByRole('textbox', { name: `Button ${index} text`, exact: true });
    await input.fill(label); await input.press('Enter');
    await expect(clip(page, id).locator('.flow-clip-type')).toContainText(`${label} Response`);
  };
  await buttons.getByLabel('Question', { exact: true }).fill('Where should we explore?');
  await buttons.getByLabel('Question', { exact: true }).press('Tab');
  await buttons.getByLabel('Button 1 text').fill('Forest');
  await buttons.getByLabel('Button 1 text').press('Enter');
  await expect(clip(page, 'correct').locator('.flow-clip-type')).toContainText('Forest Response');
  await expect(page.locator('.clip-subpanel[data-scene-id="correct"]').getByLabel('Response button', { exact: true })).toHaveValue('correct');
  await rename('incorrect', 'Ocean');
  await expect(buttons.getByLabel('Button 2 text')).toHaveValue('Ocean');
  await page.getByRole('button', { name: 'Add answer', exact: true }).click();
  const third = page.locator('.timeline-flow-clip[data-clip-kind="response"]').last();
  await expect(page.locator('.timeline-flow-clip[data-clip-kind="response"]')).toHaveCount(3);
  const id = (await third.getAttribute('data-scene-id'))!;
  await expect(undo).toHaveAttribute('title', /Add answer/);
  await undo.click(); await expect(clip(page, id)).toHaveCount(0);
  await redo.click(); await expect(clip(page, id)).toHaveCount(1);
  await rename(id, 'Mountains');
  const answerEditor = buttons.locator('.answer-editor').nth(2);
  await answerEditor.getByText('Alternative answers', { exact: true }).click();
  const alternatives = answerEditor.getByLabel('Button 3 also accepts', { exact: true });
  await alternatives.fill('Hiking\nThe mountains'); await alternatives.press('Tab');
  await expect(undo).toHaveAttribute('title', /Edit answer/);
  await undo.click(); await select(id); await expect(alternatives).toHaveValue('');
  await redo.click(); await select(id); await expect(alternatives).toHaveValue('Hiking\nThe mountains');
  await selectedEditor(page).getByRole('spinbutton', { name: 'Duration', exact: true }).fill('7');
  await selectedEditor(page).getByRole('spinbutton', { name: 'Duration', exact: true }).press('Tab');
  for (const branch of ['correct', 'incorrect']) {
    await select(branch); await expect(selectedEditor(page).getByRole('spinbutton', { name: 'Duration', exact: true })).toHaveValue('7');
  }
  const rows = await Promise.all(['correct', 'incorrect', id].map(id => clip(page, id).boundingBox()));
  const idle = (await clip(page, 'wait').boundingBox())!;
  const container = (await page.locator('.timeline-interstitial-container').boundingBox())!;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    expect(row.height).toBe(76); expect(row.x).toBeCloseTo(rows[0]!.x, 1);
    // Saved clips keep their rendered lengths; the new draft previews its edited seven seconds.
    if (index < 2) expect(row.width).toBeCloseTo(rows[0]!.width, 1);
    else expect(row.width).toBeCloseTo(rows[0]!.width * 7 / 4, 1);
    if (index) expect(row.y).toBeCloseTo(rows[index - 1]!.y + 76, 1);
    expect(row.y).toBeGreaterThan(container.y); expect(row.y + row.height).toBeLessThan(container.y + container.height);
  }
  expect(idle.y + 38).toBeCloseTo(rows[1]!.y + 38, 1);
  for (const [sceneId, label] of [['correct', 'Forest'], ['incorrect', 'Ocean'], [id, 'Mountains']]) {
    await selectIdle(page);
    await expect(page.locator('.player-branch-controls button')).toHaveCount(3);
    await branchButton(page, label).click();
    await expect(branchButton(page, label)).toHaveAttribute('aria-pressed', 'true');
    await expect(branchButton(page, label)).toHaveText(label);
    await expect(page.locator('.player-branch-controls button[aria-pressed="false"]')).toHaveCount(2);
    await expect(clip(page, sceneId)).toHaveAttribute('data-active', 'true', { timeout: 7000 });
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
  }
  await selectIdle(page); await buttons.getByRole('combobox', { name: 'Unmatched answer' }).selectOption('');
  await expect.poll(() => page.evaluate(async () => {
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    const project = await readActiveProject();
    return { labels: project.callResponse.interaction.answers.map((answer: any) => answer.label),
      fallback: project.callResponse.interaction.fallbackAnswerId, jobs: project.interstitials.length };
  })).toEqual({ labels: ['Forest', 'Ocean', 'Mountains'], fallback: null, jobs: 5 });
  await reloadWorkingProject(page); await expect(clip(page, id)).toBeVisible();
  await select(id); await answerEditor.getByText('Alternative answers', { exact: true }).click();
  await expect(alternatives).toHaveValue('Hiking\nThe mountains');
  await expect(selectedEditor(page).getByRole('spinbutton', { name: 'Duration', exact: true })).toHaveValue('7');
  await answerEditor.getByRole('button', { name: 'Remove answer', exact: true }).click();
  await expect(clip(page, id)).toHaveCount(0);
  await expect(undo).toHaveAttribute('title', /Remove answer/);
  await undo.click(); await expect(clip(page, id)).toBeVisible();
  await select(id); await expect(alternatives).toHaveValue('Hiking\nThe mountains');
  await redo.click(); await expect(clip(page, id)).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    return (await readActiveProject()).interstitials.length;
  })).toBe(4);
  await undo.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await selectIdle(page);
  await expect(page.locator('.player-branch-question')).toHaveText('Where should we explore?');
  await expect(page.locator('.player-branch-question')).toBeInViewport();
  for (const label of ['Forest', 'Ocean', 'Mountains']) await expect(branchButton(page, label)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const controls = (await page.locator('.player-branch-controls').boundingBox())!, stage = (await page.locator('.video-stage').boundingBox())!;
  expect(controls.x + controls.width / 2).toBeCloseTo(stage.x + stage.width / 2, 1);
  for (const label of ['Forest', 'Ocean', 'Mountains']) {
    const button = (await branchButton(page, label).boundingBox())!;
    expect(button.y).toBeGreaterThanOrEqual(controls.y);
    expect(button.y + button.height).toBeLessThanOrEqual(controls.y + controls.height + 1);
  }
  await clip(page, id).scrollIntoViewIfNeeded();
  const mobileRow = (await clip(page, id).boundingBox())!, scrollArea = (await page.locator('.timeline-scroll').boundingBox())!;
  expect(mobileRow.y + mobileRow.height).toBeLessThanOrEqual(scrollArea.y + scrollArea.height + 1);
  await page.screenshot({ path: 'test-results/arbitrary-answers-mobile.png' });
  await branchButton(page, 'Mountains').click();
  await expect(page.locator('.player-branch-controls')).toHaveAttribute('data-phase', 'holding');
  await expect.poll(async () => { const button = (await branchButton(page, 'Mountains').boundingBox())!; return Math.abs(button.x + button.width / 2 - stage.x - stage.width / 2); }).toBeLessThan(1);
  await expect(page.locator('.player-branch-question')).toBeHidden();
  await page.screenshot({ path: 'test-results/selected-custom-answer-mobile.png' });
  await selectIdle(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.timeline-scroll').evaluate(element => { element.scrollTop = 0; element.scrollLeft = 0; });
  const desktopRow = (await clip(page, id).boundingBox())!, desktopArea = (await page.locator('.timeline-scroll').boundingBox())!;
  expect(desktopRow.y + desktopRow.height).toBeLessThanOrEqual(desktopArea.y + desktopArea.height + 1);
  await page.screenshot({ path: 'test-results/arbitrary-answers-desktop.png' });
});

test('untouched legacy response names become A and B on reload without changing media or routes', async ({ page }) => {
  await openExample(page);
  const media = await page.evaluate(async () => {
    const { readActiveProject, writeProject } = await import('/src/features/project/database.ts' as string);
    const project = await readActiveProject();
    for (const flow of [project.callResponse, ...project.callResponses]) {
      for (const [id, label, sceneLabel] of [['correct', 'Correct', 'Celebrate'], ['incorrect', 'Incorrect', 'Give a hint']]) {
        flow.interaction.answers.find((answer: any) => answer.id === id).label = label;
        const scene = flow.scenes.find((scene: any) => scene.id === id);
        scene.label = sceneLabel;
        project.interstitials.find((item: any) => item.id === scene.interstitialId).label = sceneLabel;
      }
    }
    await writeProject(project);
    return project.interstitials.map((item: any) => item.result.assetId);
  });
  await reloadWorkingProject(page);
  await selectIdle(page);
  await expect(branchButton(page, 'correct')).toBeVisible();
  await expect(branchButton(page, 'incorrect')).toBeVisible();
  await expect(page.locator('[data-edge-id="wait-correct"]')).toHaveAttribute('data-to', 'correct');
  await expect.poll(() => page.evaluate(async () => {
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    const project = await readActiveProject();
    return { labels: project.callResponse.interaction.answers.map((answer: any) => answer.label),
      names: project.interstitials.slice(2).map((item: any) => item.label), media: project.interstitials.map((item: any) => item.result.assetId) };
  })).toEqual({ labels: ['A', 'B'], names: ['A', 'B'], media });
});

test('undo and redo add, edit, move and remove drafts, group typing, and reset when opening another project', async ({ page }) => {
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  await openExample(page, async () => {
    await expect(undo).toBeDisabled(); await expect(redo).toBeDisabled();
    const help = page.getByRole('button', { name: 'What is an interstitial?', exact: true });
    await help.click();
    await expect(page.getByRole('note')).toContainText('A short scene inserted between parts of your video.');
    await expect(page.locator('.timeline-pin')).toHaveCount(0);
    await page.keyboard.press('Escape'); await expect(page.getByRole('note')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await help.click(); await expect(page.getByRole('note')).toBeInViewport();
    await expect(page.getByRole('button', { name: /^Add regular interstitial/ })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: 'test-results/interstitial-help-mobile.png' });
    await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('2');
    await page.getByRole('button', { name: /^Add regular interstitial/ }).click();
    await expect(undo).toHaveAttribute('title', /Add interstitial/);
    await undo.click(); await expect(page.locator('.timeline-pin')).toHaveCount(0);
    await page.keyboard.press('Control+y'); await expect(page.locator('.timeline-pin')).toHaveCount(1);
    const name = page.getByRole('textbox', { name: 'Interstitial name', exact: true });
    await expect(name).toHaveValue('Untitled');
    await name.fill('Opening scene'); await name.press('Enter');
    await expect(page.locator('.timeline-pin')).toHaveAccessibleName('Select Opening scene at 00:02');
    await expect(undo).toHaveAttribute('title', /Rename interstitial/);
    await undo.click(); await expect(name).toHaveValue('Untitled');
    await redo.click(); await expect(name).toHaveValue('Opening scene');
    await name.fill('Discard this name'); await name.press('Escape'); await expect(name).toHaveValue('Opening scene');
    await name.fill('   '); await name.press('Enter'); await expect(name).toHaveValue('Untitled');
    const prompt = page.getByRole('textbox', { name: 'Interstitial prompt' });
    await prompt.pressSequentially('A new scene', { delay: 15 });
    await expect(undo).toHaveAttribute('title', /Edit prompt/);
    await prompt.press('Control+z'); await expect(prompt).toHaveValue('');
    await expect(prompt).toBeFocused();
    await page.keyboard.press('Control+Shift+z'); await expect(prompt).toHaveValue('A new scene');
    const pin = page.locator('.timeline-pin');
    await pin.focus(); await pin.press('Shift+ArrowRight');
    await expect(pin).toHaveAccessibleName('Select Untitled at 00:03');
    await undo.click(); await expect(pin).toHaveAccessibleName('Select Untitled at 00:02');
    await redo.click(); await expect(pin).toHaveAccessibleName('Select Untitled at 00:03');
    await pin.click(); await pin.press('Delete'); await expect(pin).toHaveCount(0);
    await undo.click(); await expect(prompt).toHaveValue('A new scene');
    await expect(pin).toHaveAccessibleName('Select Untitled at 00:03');
    await prompt.fill('A different scene'); await expect(redo).toBeDisabled();
    await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('1');
    await page.getByRole('button', { name: 'Zoom in timeline' }).click();
    await expect(undo).toHaveAttribute('title', /Edit prompt/);
    await page.getByRole('slider', { name: 'Timeline zoom', exact: true }).focus();
    await page.keyboard.press('Control+z'); await expect(prompt).toHaveValue('A new scene');
    await redo.click(); await expect(prompt).toHaveValue('A different scene');
  });
  await expect(undo).toBeDisabled(); await expect(redo).toBeDisabled();
  const name = page.getByRole('textbox', { name: 'Interstitial name', exact: true });
  await selectIdle(page);
  const previousTime = await video(page).evaluate(element => (element as HTMLVideoElement).currentTime);
  await name.fill('Math challenge'); await name.press('Enter');
  await expect(page.locator('.timeline-interstitial-group')).toHaveAccessibleName('Math challenge');
  await expect(clip(page, 'wait')).toHaveAttribute('data-active', 'true');
  expect(await video(page).evaluate(element => (element as HTMLVideoElement).currentTime)).toBeCloseTo(previousTime, 2);
  await undo.click(); await expect(name).toHaveValue('Untitled');
  await redo.click(); await expect(name).toHaveValue('Math challenge');
  await expect.poll(() => page.evaluate(async () => {
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    return (await readActiveProject()).callResponse.interstitial.label;
  })).toBe('Math challenge');
  await reloadWorkingProject(page);
  await expect(page.locator('.timeline-interstitial-group')).toHaveAccessibleName('Math challenge');
  await page.locator('.timeline-interstitial-marker .timeline-pin').click();
  await expect(name).toHaveValue('Math challenge');
});

test('undo restores the whole deleted call-response interstitial and redo removes it again', async ({ page }) => {
  await openExample(page);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  const group = page.locator('.timeline-interstitial-group');
  const id = await group.getAttribute('data-interstitial-id');
  await page.getByRole('button', { name: 'Remove Untitled', exact: true }).click();
  await expect(group).toHaveCount(0);
  await expect(undo).toHaveAttribute('title', /Remove call-response interstitial/);
  await undo.click();
  await expect(group).toHaveAttribute('data-interstitial-id', id!);
  await expect(group.locator('.timeline-flow-clip')).toHaveCount(4);
  await expect(page.locator('.timeline-interstitial-container')).toHaveAttribute('aria-pressed', 'true');
  await selectIdle(page);
  await expect(branchButton(page, 'correct')).toBeVisible();
  await expect(clip(page, 'wait').locator('.video-filmstrip img').first()).toBeVisible();
  await redo.click(); await expect(group).toHaveCount(0);
  await page.keyboard.press('Control+z'); await expect(group).toHaveCount(1);
  await expect.poll(() => page.evaluate(async () => {
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    const project = await readActiveProject();
    return { group: project.callResponse?.interstitial.id, clips: project.interstitials.length };
  })).toEqual({ group: id, clips: 4 });
  await reloadWorkingProject(page);
  await expect(group).toHaveAttribute('data-interstitial-id', id!);
  await expect(undo).toBeDisabled(); await expect(redo).toBeDisabled();
});

test('fixed clip roles, response assignments and shared durations support undo on mobile', async ({ page }) => {
  await openExample(page);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  await selectIdle(page);
  await expect(page.getByRole('combobox', { name: 'Clip type', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Clip dialogue', exact: true })).toHaveCount(0);
  await clip(page, 'incorrect').getByRole('button', { name: 'Inspect ended from B', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Connection destination', exact: true })).toHaveCount(0);
  await selectedEditor(page).getByRole('combobox', { name: 'Response button', exact: true }).selectOption('correct');
  const edge = page.locator('[data-edge-id="wait-correct"]');
  await expect(edge).toHaveAttribute('data-to', 'incorrect');
  await expect(page.locator('[data-edge-id="wait-incorrect"]')).toHaveAttribute('data-to', 'correct');
  await expect(clip(page, 'wait')).toHaveAttribute('data-clip-kind', 'idle');
  await expect(clip(page, 'incorrect')).toHaveAttribute('data-clip-kind', 'response');
  await undo.click(); await expect(edge).toHaveAttribute('data-to', 'correct');
  await redo.click(); await expect(edge).toHaveAttribute('data-to', 'incorrect');
  await undo.click();
  await clip(page, 'correct').getByRole('button', { name: 'Select clip A', exact: true }).click();
  await selectedEditor(page).getByRole('spinbutton', { name: 'Duration', exact: true }).fill('8');
  await undo.click();
  await expect(selectedEditor(page).getByRole('spinbutton', { name: 'Duration', exact: true })).toHaveValue('6');
  await clip(page, 'incorrect').getByRole('button', { name: 'Select clip B', exact: true }).click();
  await expect(selectedEditor(page).getByRole('spinbutton', { name: 'Duration', exact: true })).toHaveValue('6');
  await redo.click();
  await expect(selectedEditor(page).getByRole('spinbutton', { name: 'Duration', exact: true })).toHaveValue('8');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(undo).toBeInViewport(); await expect(redo).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/undo-redo-mobile.png' });
});

test('subtitle import can be undone and redone', async ({ page }) => {
  await openExample(page, async () => {
    await page.getByLabel('Choose subtitle file').setInputFiles({ name: 'dialogue.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nUndoable subtitles\n') });
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveAttribute('title', /Change subtitles/);
    await expect(video(page).locator('track')).toHaveCount(1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(video(page).locator('track')).toHaveCount(0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(video(page).locator('track')).toHaveCount(1);
  });
});

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
  await expect(group).toHaveAccessibleName('Untitled');
  await expect(group.locator('.flow-clip-type')).toHaveText(['Call', 'Idle', 'A Response', 'B Response']);
  await expect(group.locator('.timeline-flow-clip')).toHaveCount(4);
  await expect(clip(page, 'intro').locator('.flow-clip-type')).toHaveCount(0);
  await expect(clip(page, 'continue').locator('.flow-clip-type')).toHaveCount(0);
  await expect(clip(page, 'wait').getByRole('img', { name: 'Loops until an answer' })).toBeVisible();
  await expect(page.locator('.timeline-heading .eyebrow')).toHaveText('TIMELINE / 1 INTERSTITIAL');
  await page.getByRole('button', { name: 'All interstitials', exact: true }).click();
  await expect(page.locator('.interstitial-list > li')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Clips in Untitled' }).getByRole('button')).toHaveCount(4);
  await page.getByRole('button', { name: 'Select Idle clip', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Interstitial name', exact: true })).toHaveValue('Untitled');
  await expect(page.getByRole('region', { name: 'Idle clip', exact: true }).getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible();
  await clip(page, 'intro').getByRole('button', { name: 'Select clip Source · before', exact: true }).click();
  await expect(page.locator('.flow-video-caption, .flow-video-label')).toHaveCount(0);
  await expect(page.locator('.timeline-section').getByRole('button', { name: /^Choose / })).toHaveCount(0);
  await expect(branchButton(page, 'correct')).toHaveCount(0);
  await expect(clip(page, 'wait')).toHaveAttribute('data-clip-kind', 'idle');
  await clip(page, 'wait').getByRole('button', { name: 'Select clip Idle · waiting for an answer', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(selectedEditor(page).getByRole('combobox', { name: 'Clip type', exact: true })).toHaveCount(0);
  await expect(page.locator('.player-branch-question')).toHaveText('What is 2 + 2?');
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

test('response button assignments persist, route the real video, and a new sample opens clean', async ({ page }) => {
  await openExample(page, async () => {
    await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('2');
    await page.getByRole('button', { name: /^Add regular interstitial/ }).click();
    await page.getByRole('textbox', { name: 'Interstitial prompt', exact: true }).fill('Keep the original draft.');
  });
  await clip(page, 'incorrect').locator('.flow-clip-body').click();
  const originalPrompt = await selectedEditor(page).getByLabel('Interstitial prompt').inputValue();
  await selectedEditor(page).getByRole('combobox', { name: 'Response button', exact: true }).selectOption('correct');
  await expect(selectedEditor(page).getByLabel('Interstitial prompt')).toHaveValue(originalPrompt);
  await expect(page.locator('[data-edge-id="wait-incorrect"]')).toHaveAttribute('data-to', 'correct');
  const groupId = await page.locator('.timeline-interstitial-group').getAttribute('data-interstitial-id');
  await reloadWorkingProject(page);
  await expect(page.locator('.timeline-interstitial-group')).toHaveAttribute('data-interstitial-id', groupId!);
  await expect(page.locator('[data-edge-id="wait-incorrect"]')).toHaveAttribute('data-to', 'correct');
  await expect(page.locator('.buffering')).toHaveCount(0, { timeout: 30_000 });
  await selectIdle(page);
  await branchButton(page, 'incorrect').click();
  await expect(clip(page, 'correct')).toHaveAttribute('data-active', 'true', { timeout: 7000 });
  await expect(clip(page, 'continue')).toHaveAttribute('data-active', 'true', { timeout: 7000 });
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Close project' }).click();
  await page.getByRole('dialog', { name: 'Save changes before closing?' }).getByRole('button', { name: 'Discard changes' }).click();
  await page.getByRole('button', { name: /Sample video/ }).click();
  await expect(page.locator('.timeline-section.has-flow')).toHaveCount(0);
  await expect(page.locator('.timeline-pin')).toHaveCount(0);
});

test('idle has a fixed role and the question and player buttons fit on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openExample(page);
  await clip(page, 'wait').getByRole('button', { name: 'Select clip Idle · waiting for an answer', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Clip type', exact: true })).toHaveCount(0);
  await expect(clip(page, 'wait')).toHaveAttribute('data-clip-kind', 'idle');
  await expect(clip(page, 'wait').getByRole('img', { name: 'Loops until an answer' })).toBeVisible();
  await expect(page.locator('.timeline-interstitial-group .timeline-flow-clip')).toHaveCount(4);
  await selectIdle(page);
  await expect(page.locator('.player-branch-question')).toHaveText('What is 2 + 2?');
  await expect(page.locator('.player-branch-question')).toBeInViewport();
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
  await clip(page, 'correct').getByRole('button', { name: 'Select clip A', exact: true }).click();
  await selectedEditor(page).getByRole('spinbutton', { name: 'Duration', exact: true }).fill('7.5');
  await clip(page, 'incorrect').getByRole('button', { name: 'Select clip B', exact: true }).click();
  await expect(selectedEditor(page).getByRole('spinbutton', { name: 'Duration', exact: true })).toHaveValue('7.5');
  await expect(selectedEditor(page).getByText('Shared duration for all response branches.', { exact: false })).toBeVisible();
  await reloadWorkingProject(page);
  await clip(page, 'correct').getByRole('button', { name: 'Select clip A', exact: true }).click();
  await expect(selectedEditor(page).getByRole('spinbutton', { name: 'Duration', exact: true })).toHaveValue('7.5');
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
  const container = page.getByRole('button', { name: 'Select entire Untitled', exact: true });
  const parent = page.getByLabel('Call Response Interstitial panel', { exact: true });
  const child = (label: string) => parent.getByRole('region', { name: `${label} clip`, exact: true });
  await expect(container).toHaveAttribute('aria-pressed', 'true');
  await expect(parent.locator('.clip-subpanel')).toHaveCount(4);
  await expect(parent.getByRole('textbox', { name: 'Interstitial prompt', exact: true })).toHaveCount(4);
  for (const field of await parent.getByRole('textbox', { name: 'Interstitial prompt', exact: true }).all()) await expect(field).toBeEditable();
  const bounds = (await container.boundingBox())!;
  for (const id of ['call', 'wait', 'correct', 'incorrect']) {
    const box = (await clip(page, id).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x); expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(box.y).toBeGreaterThanOrEqual(bounds.y); expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  }
  await child('Call').locator('.clip-subpanel-heading').click();
  await child('Call').getByRole('textbox', { name: 'Interstitial prompt' }).fill('An independently edited call');
  await expect(page.locator('.timeline-flow-clip[data-stale=true]')).toHaveCount(0);
  const previousTime = await video(page).evaluate(element => (element as HTMLVideoElement).currentTime);
  await container.focus(); await page.keyboard.press('Enter');
  await expect(container).toHaveAttribute('aria-pressed', 'true');
  expect(await video(page).evaluate(element => (element as HTMLVideoElement).currentTime)).toBeCloseTo(previousTime, 1);
  await child('Call').locator('.clip-subpanel-heading').click();
  await child('Call').getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(child('Call').getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled({ timeout: 30_000 });
  expect(submissions).toBe(1);
  await expect(child('Idle').locator('.clip-subpanel-heading small')).toHaveText('Stale · Needs regeneration');
  await expect(clip(page, 'call')).toHaveAttribute('data-stale', 'false');
  for (const id of ['wait', 'correct', 'incorrect']) {
    await expect(clip(page, id)).toHaveAttribute('data-stale', 'true');
    await expect(clip(page, id).getByText('Stale', { exact: true })).toBeVisible();
  }
  await expect(page.locator('.timeline-interstitial-marker')).not.toHaveClass(/ready/);
  await parent.getByRole('button', { name: 'All interstitials' }).click();
  await expect(page.locator('.interstitial-row[data-stale=true]')).toHaveCount(3);
  await expect(page.locator('.interstitial-group-heading')).not.toHaveClass(/ready/);
  await container.focus(); await page.keyboard.press('Enter');
  await child('A Response').locator('.clip-subpanel-heading').click();
  await expect(child('A Response').getByRole('button', { name: 'Regenerate', exact: true })).toBeDisabled();
  await expect(child('A Response').getByText('Regenerate Idle first to use the updated preceding clip.')).toBeVisible();
  await child('Idle').locator('.clip-subpanel-heading').click();
  await child('Idle').getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(child('Idle').getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled({ timeout: 30_000 });
  expect(submissions).toBe(2);
  await expect(clip(page, 'wait')).toHaveAttribute('data-stale', 'false');
  await expect(page.locator('.timeline-flow-clip[data-stale=true]')).toHaveCount(2);
  await child('A Response').locator('.clip-subpanel-heading').click();
  await child('A Response').getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(child('A Response').getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled({ timeout: 30_000 });
  expect(submissions).toBe(3);
  await expect(child('A Response').locator('.clip-subpanel-heading small')).toHaveText('Ready');
  await expect(child('B Response').locator('.clip-subpanel-heading small')).toHaveText('Stale · Needs regeneration');
  await expect(clip(page, 'correct')).toHaveAttribute('data-stale', 'false');
  await expect(page.locator('.timeline-flow-clip[data-stale=true]')).toHaveCount(1);
  await reloadWorkingProject(page);
  await container.click({ position: { x: 5, y: 5 } });
  await expect(child('A Response').locator('.clip-subpanel-heading small')).toHaveText('Ready');
  await expect(child('B Response').locator('.clip-subpanel-heading small')).toHaveText('Stale · Needs regeneration');
  await expect(clip(page, 'incorrect')).toHaveAttribute('data-stale', 'true');
  await expect(clip(page, 'incorrect').getByText('Stale', { exact: true })).toBeVisible();
  await child('Call').locator('.clip-subpanel-heading').click();
  await expect(child('Call').getByRole('textbox', { name: 'Interstitial prompt' })).toHaveValue('An independently edited call');
  expect(errors).toEqual([]);
});

test('empty timeline space and the ruler seek at the clicked position, including zoom and scroll', async ({ page }) => {
  await openExample(page, async () => {
    await page.getByRole('separator', { name: 'Resize timeline', exact: true }).focus();
    await page.keyboard.press('End');
    const duration = await video(page).evaluate(element => (element as HTMLVideoElement).duration);
    for (const zoom of ['1', '3']) {
      await page.getByRole('slider', { name: 'Timeline zoom', exact: true }).fill(zoom);
      await page.getByLabel('Scrollable timeline').evaluate(element => { element.scrollLeft = element.clientWidth / 2; });
      const content = (await page.locator('.timeline-content').boundingBox())!;
      const viewport = (await page.getByLabel('Scrollable timeline').boundingBox())!;
      const space = (await page.locator('.timeline-track-space').boundingBox())!;
      const x = viewport.x + viewport.width * .6;
      await page.mouse.click(x, space.y + 5);
      const target = Math.round((x - content.x) / content.width * duration * 24) / 24;
      await expect.poll(() => video(page).evaluate(element => (element as HTMLVideoElement).currentTime)).toBeCloseTo(target, 2);
    }
    await page.getByRole('button', { name: 'Fit timeline' }).click();
  });
  const flow = await page.evaluate(async () => {
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    return (await readActiveProject()).callResponse;
  });
  for (const zoom of ['1', '3']) {
    await page.getByRole('slider', { name: 'Timeline zoom', exact: true }).fill(zoom);
    await clip(page, 'wait').scrollIntoViewIfNeeded();
    const idle = (await clip(page, 'wait').boundingBox())!;
    const container = (await page.locator('.timeline-interstitial-container').boundingBox())!;
    await page.mouse.click(idle.x + idle.width / 2, container.y + 5);
    await expect(clip(page, 'wait')).toHaveAttribute('data-active', 'true');
    const scene = flow.scenes.find((scene: any) => scene.id === 'wait');
    const expected = Math.round((scene.clip.outFrame - scene.clip.inFrame) / 2) / (scene.clip.outFrame - scene.clip.inFrame) * 100;
    await expect.poll(() => clip(page, 'wait').locator('.flow-playhead').evaluate(element => parseFloat((element as HTMLElement).style.left))).toBeCloseTo(expected, 2);
    await expect(page.locator('.timeline-interstitial-container')).toHaveAttribute('aria-pressed', 'true');
    const ruler = (await page.locator('.timeline-ruler').boundingBox())!;
    await page.mouse.click(idle.x + idle.width * .25, ruler.y + 5);
    const rulerPosition = Math.round((scene.clip.outFrame - scene.clip.inFrame) / 4) / (scene.clip.outFrame - scene.clip.inFrame) * 100;
    await expect.poll(() => clip(page, 'wait').locator('.flow-playhead').evaluate(element => parseFloat((element as HTMLElement).style.left))).toBeCloseTo(rulerPosition, 2);
  }
  await page.getByRole('button', { name: 'Fit timeline' }).click();
  await clip(page, 'incorrect').getByRole('button', { name: 'Select clip B', exact: true }).focus();
  await page.keyboard.press('Enter');
  const branch = (await clip(page, 'incorrect').boundingBox())!;
  const tracks = (await page.locator('.timeline-flow-tracks').boundingBox())!;
  await page.mouse.click(branch.x + branch.width / 2, tracks.y + tracks.height - 5);
  await expect(clip(page, 'incorrect')).toHaveAttribute('data-active', 'true');
  const incorrect = flow.scenes.find((scene: any) => scene.id === 'incorrect');
  await expect.poll(() => clip(page, 'incorrect').locator('.flow-playhead').evaluate(element => parseFloat((element as HTMLElement).style.left)))
    .toBeCloseTo(Math.round((incorrect.clip.outFrame - incorrect.clip.inFrame) / 2) / (incorrect.clip.outFrame - incorrect.clip.inFrame) * 100, 2);
});

for (const action of ['panel', 'list', 'Delete', 'Backspace']) {
  test(`removing a call-response interstitial from ${action} keeps the source and unrelated drafts after reload`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await openExample(page);
    const sourceId = await page.evaluate(async () => {
      const { readActiveProject, writeProject } = await import('/src/features/project/database.ts' as string);
      const project = await readActiveProject();
      await writeProject({ ...project, interstitials: [...project.interstitials, {
        ...project.interstitials[0], id: 'unrelated-draft', label: 'Keep this draft', phase: 'draft', result: undefined, time: .5,
      }] });
      return project.source.assetId;
    });
    await reloadWorkingProject(page);
    await expect(page.locator('.timeline-section.has-flow')).toBeVisible();
    await expect(page.locator('.buffering')).toHaveCount(0, { timeout: 30_000 });
    if (action === 'panel') {
      await page.locator('.timeline-interstitial-marker .timeline-pin').click();
      await page.getByRole('button', { name: 'Remove Untitled', exact: true }).click();
    } else if (action === 'list') {
      await page.getByRole('button', { name: 'Remove Untitled', exact: true }).click();
    } else {
      await page.locator('.timeline-interstitial-container').focus();
      await page.keyboard.press('Enter'); await page.keyboard.press(action);
    }
    await expect(page.locator('.timeline-section.has-flow')).toHaveCount(0);
    await expect(page.locator('.interstitial-list > li')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Select Keep this draft', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Choose an answer' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => {
      const { readActiveProject } = await import('/src/features/project/database.ts' as string);
      const project = await readActiveProject();
      return { source: project.source.assetId, hasFlow: !!project.callResponse, ids: project.interstitials.map((item: any) => item.id) };
    })).toEqual({ source: sourceId, hasFlow: false, ids: ['unrelated-draft'] });
    await reloadWorkingProject(page);
    const timeline = page.getByRole('slider', { name: 'Video timeline', exact: true });
    await expect(timeline).toBeEnabled({ timeout: 30_000 });
    await timeline.fill('1');
    await expect.poll(() => video(page).evaluate(element => (element as HTMLVideoElement).currentTime)).toBeCloseTo(1, 2);
    await expect(page.getByRole('button', { name: 'Select Keep this draft', exact: true })).toBeVisible();
    await expect(page.locator('.timeline-section.has-flow')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
