import { test, expect, openVideo, addBridge, readProject, saveAndReopen } from './fixtures';

for (const kind of ['video', 'image'] as const) for (const width of [1440, 390]) test(`${kind} AI prompt edits support undo, retry and cancellation without layout shifts at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/api/status', async route => {
    const status = await (await route.fetch()).json();
    await route.fulfill({ json: { ...status, providers: { ...status.providers, openai: true, fal: true, comfy: true } } });
  });
  await openVideo(page);
  if (kind === 'video') await addBridge(page);
  else await page.getByRole('button', { name: 'Add image', exact: true }).press('Enter');
  const original = kind === 'video' ? 'She holds a sock silently.' : 'A poster reading "SUNRISE".';
  const instructions = kind === 'video' ? 'Add "Or this sock?" while she holds the sock.' : 'Change the title to "MOONRISE".';
  const edited = kind === 'video' ? 'She holds the sock and asks <d>[English] Or this sock?</d>.' : 'A poster reading "MOONRISE".';
  const prompt = page.getByLabel(kind === 'video' ? 'Video prompt' : 'Generation prompt', { exact: true });
  const edit = page.getByRole('button', { name: 'Edit with AI', exact: true });
  await prompt.fill(''); await expect(edit).toBeDisabled();
  await prompt.fill(original); await expect(edit).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeVisible();
  await edit.scrollIntoViewIfNeeded();
  const fieldLayout = () => page.locator('.inspector-prompt').evaluate(root => {
    const top = root.getBoundingClientRect().top;
    return [...root.children].map(el => ({ top: el.getBoundingClientRect().top - top, height: el.getBoundingClientRect().height }));
  });
  const before = await fieldLayout();
  let finish!: () => void, gate = new Promise<void>(resolve => { finish = resolve; }), calls = 0, generations = 0;
  await page.route('**/api/comfy/interstitials', route => { generations++; return route.fulfill({ status: 500, json: { error: 'Unexpected generation' } }); });
  await page.route('**/api/library-generations', route => { generations++; return route.fulfill({ status: 500, json: { error: 'Unexpected generation' } }); });
  await page.route(kind === 'video' ? '**/api/interstitials/enhance-prompt' : '**/api/image-prompts/enhance', async route => {
    calls++;
    const body = route.request().postDataJSON();
    expect(body.editInstructions).toBe(instructions);
    expect(kind === 'video' ? body.prompt : body.settings.prompt).toBe(calls === 1 ? original : edited);
    if (calls === 2) return route.fulfill({ status: 502, json: { error: 'Please retry this edit.' } });
    await gate;
    await route.fulfill({ json: { prompt: edited, model: body.settings?.model ?? 'test-model' } }).catch(() => undefined);
  });
  await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Edit prompt with AI', exact: true });
  const changes = dialog.getByLabel('What should change?', { exact: true });
  await expect(changes).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Apply edit', exact: true })).toBeDisabled();
  await changes.fill(instructions);
  const dialogLayout = () => dialog.locator('form').evaluate(root => {
    const top = root.getBoundingClientRect().top;
    return [...root.children].map(el => ({ top: el.getBoundingClientRect().top - top, height: el.getBoundingClientRect().height }));
  });
  const idle = await dialogLayout();
  await dialog.getByRole('button', { name: 'Apply edit', exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await expect(dialog.getByRole('button', { name: 'Editing…', exact: true })).toBeDisabled();
  expect(await dialogLayout()).toEqual(idle); expect(await fieldLayout()).toEqual(before);
  await page.screenshot({ path: `test-results/prompt-edit-${kind}-${width}-loading.png` });
  finish();
  await expect(dialog).toHaveCount(0); await expect(prompt).toHaveValue(edited); await expect(edit).toBeFocused();
  expect(await fieldLayout()).toEqual(before); expect(generations).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(prompt).toHaveValue(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(prompt).toHaveValue(edited);
  await edit.click(); await changes.fill(instructions);
  await changes.press('Control+Enter');
  await expect(dialog.getByRole('status')).toContainText('Please retry this edit.');
  await expect(changes).toHaveValue(instructions); await expect(prompt).toHaveValue(edited);
  expect(await dialogLayout()).toEqual(idle); expect(await fieldLayout()).toEqual(before);
  await page.screenshot({ path: `test-results/prompt-edit-${kind}-${width}-error.png` });
  gate = new Promise<void>(resolve => { finish = resolve; });
  await dialog.getByRole('button', { name: 'Apply edit', exact: true }).click();
  await expect.poll(() => calls).toBe(3);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  finish(); await expect(edit).toBeEnabled(); await expect(prompt).toHaveValue(edited);
  expect(await fieldLayout()).toEqual(before); expect(generations).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});


for (const kind of ['video', 'image'] as const) for (const width of [1440, 390]) test(`${kind} original and enhanced prompts edit atomically and persist at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/api/status', async route => {
    const status = await (await route.fetch()).json();
    await route.fulfill({ json: { ...status, providers: { ...status.providers, openai: true, fal: true, comfy: true } } });
  });
  await openVideo(page);
  if (kind === 'video') await addBridge(page);
  else await page.getByRole('button', { name: 'Add image', exact: true }).press('Enter');
  const original = page.getByLabel(kind === 'video' ? 'Video prompt' : 'Generation prompt', { exact: true });
  const downstream = page.getByLabel('Enhanced prompt', { exact: true });
  const choice = page.getByLabel('Prompt used for generation', { exact: true });
  await original.fill('A room in daylight.');
  const beforeText = 'A quiet room in daylight. Keep the composition steady.';
  const afterText = 'A quiet room in warm evening light. Keep the composition steady.';
  let edits = 0, finish!: () => void;
  let gate = new Promise<void>(resolve => { finish = resolve; });
  await page.route(kind === 'video' ? '**/api/interstitials/enhance-prompt' : '**/api/image-prompts/enhance', async route => {
    const body = route.request().postDataJSON(), settings = kind === 'video' ? body : body.settings;
    if (!body.editInstructions) return route.fulfill({ json: { prompt: beforeText, model: body.settings?.model ?? 'test' } });
    edits++;
    expect(settings.prompt).toBe(edits === 1 ? 'A room in daylight.' : 'A room in evening light.');
    expect(settings.enhancedPrompt).toBe(edits === 1 ? beforeText : afterText);
    if (edits === 2) return route.fulfill({ json: { prompt: 'This incomplete edit must not be applied.', model: body.settings?.model ?? 'test' } });
    await gate;
    await route.fulfill({ json: { prompt: 'A room in evening light.', enhancedPrompt: afterText, model: body.settings?.model ?? 'test' } }).catch(() => undefined);
  });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect(downstream).toHaveValue(beforeText); await expect(original).toHaveValue('A room in daylight.');
  await expect(choice).toHaveValue('enhanced');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(downstream).toHaveValue(''); await expect(choice).toHaveValue('original');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(downstream).toHaveValue(beforeText);
  const layout = () => page.locator('.inspector-prompt').evaluate(root => {
    const top = root.getBoundingClientRect().top;
    return [...root.children].map(el => ({ top: el.getBoundingClientRect().top - top, height: el.getBoundingClientRect().height }));
  });
  const idle = await layout();
  const edit = page.getByRole('button', { name: 'Edit with AI', exact: true });
  await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Edit prompt with AI', exact: true });
  await expect(dialog).toContainText('both the original and enhanced prompts');
  await dialog.getByLabel('What should change?', { exact: true }).fill('Change daylight to evening light.');
  await dialog.getByRole('button', { name: 'Apply edit', exact: true }).click();
  await expect.poll(() => edits).toBe(1);
  await expect(original).toHaveValue('A room in daylight.'); await expect(downstream).toHaveValue(beforeText);
  expect(await layout()).toEqual(idle);
  await page.screenshot({ path: `test-results/paired-edit-${kind}-${width}-loading.png` });
  finish(); await expect(dialog).toHaveCount(0);
  await expect(original).toHaveValue('A room in evening light.'); await expect(downstream).toHaveValue(afterText);
  expect(await layout()).toEqual(idle);
  // Undo, redo and persistence run once, at full width.
  if (width === 1440) {
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(original).toHaveValue('A room in daylight.'); await expect(downstream).toHaveValue(beforeText);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(original).toHaveValue('A room in evening light.'); await expect(downstream).toHaveValue(afterText);
  }
  await edit.click(); await dialog.getByLabel('What should change?', { exact: true }).fill('Make it warmer.');
  await dialog.getByRole('button', { name: 'Apply edit', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Your prompts have been kept');
  await expect(original).toHaveValue('A room in evening light.'); await expect(downstream).toHaveValue(afterText);
  expect(await layout()).toEqual(idle);
  if (width === 1440) {
    gate = new Promise<void>(resolve => { finish = resolve; });
    await dialog.getByRole('button', { name: 'Apply edit', exact: true }).click(); await expect.poll(() => edits).toBe(3);
    await page.keyboard.press('Escape'); finish(); await expect(dialog).toHaveCount(0);
    await expect(original).toHaveValue('A room in evening light.'); await expect(downstream).toHaveValue(afterText);
    await original.fill('A garden in evening light.');
    await expect(page.locator('.prompt-version-status')).toContainText('Original or settings changed');
    const generate = page.getByRole('button', { name: kind === 'video' ? 'Generate' : 'Generate image', exact: true });
    await expect(generate).toBeDisabled();
    await choice.selectOption('original'); await expect(generate).toBeEnabled();
    const saved = await readProject(page), state = kind === 'video' ? saved.interstitials[0] : saved.clipGenerations[0].settings;
    expect(state).toMatchObject({ prompt: 'A garden in evening light.', enhancedPrompt: afterText, enhancedPromptStale: true, useEnhancedPrompt: false });
    await saveAndReopen(page);
    await (kind === 'video' ? page.locator('.story-clip.type-simple .story-clip-title') : page.locator('.story-clip-title').filter({ hasText: saved.clipGenerations[0].name })).click();
    await expect(original).toHaveValue('A garden in evening light.'); await expect(downstream).toHaveValue(afterText); await expect(choice).toHaveValue('original');
    await expect(page.locator('.prompt-version-status')).toContainText('Original or settings changed');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
