import { addDraft, addQuestionTemplate, expect, fitAll, openVideo, readProject, saveAndReopen, test, type Page } from './fixtures';

const filename = 'iris-animation__h3_character.safetensors';
const other = 'iris-animation__h3_other.safetensors';
const panel = (page: Page) => page.getByRole('region', { name: 'Project LoRAs', exact: true });
const strength = (page: Page) => page.getByRole('spinbutton', { name: 'LoRA strength value', exact: true });
const selection = (page: Page) => page.getByLabel('Generation LoRA', { exact: true });
async function setup(page: Page) {
  await page.route('**/api/status', async route => { const response = await route.fetch(); const status = await response.json(); await route.fulfill({ json: { ...status, providers: { ...status.providers, comfy: true, openai: true } } }); });
  await page.route('**/api/comfy/loras/resolve', route => { const body = route.request().postDataJSON(); return route.fulfill({ json: { ...body, name: body.address } }); });
  await openVideo(page);
}
async function addLora(page: Page) {
  await panel(page).getByRole('button', { name: 'Add LoRA', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add LoRA', exact: true });
  await dialog.getByRole('combobox', { name: 'Model', exact: true }).click();
  await expect(dialog.getByRole('option', { name: /Nano Banana 2/ })).toBeDisabled();
  await expect(dialog.getByRole('option', { name: /Sound Effects/ })).toBeDisabled();
  await dialog.getByRole('option', { name: /^H3/ }).click();
  await dialog.getByLabel('Comfy Cloud model address', { exact: true }).fill(filename);
  return dialog;
}
async function editLora(page: Page) {
  await panel(page).getByRole('button', { name: 'Edit H3 LoRA', exact: true }).click();
  return page.getByRole('dialog', { name: 'Edit LoRA', exact: true });
}

for (const width of [1440, 390, 320]) test(`LoRA dialog is stable while checking and on failure at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width <= 390 ? 667 : 1000 }); await setup(page);
  const dialog = await addLora(page);
  let finish!: () => void, requested = false;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/comfy/loras/resolve', async route => { requested = true; await gate; await route.fulfill({ status: 400, json: { error: 'This LoRA is not available in your Comfy Cloud account. Import it there first, then paste its exact model filename.' } }); });
  const positions = () => dialog.evaluate(element => ['.lora-model-trigger', 'input', '.lora-strength input[type=range]', '.lora-strength input[type=number]', 'textarea', '.close-project-actions'].map(selector => {
    const box = element.querySelector(selector)!.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  const slider = dialog.getByRole('slider', { name: 'LoRA strength', exact: true });
  await slider.press('ArrowRight');
  await expect(dialog.getByRole('spinbutton', { name: 'LoRA strength value', exact: true })).toHaveValue('1.01');
  await slider.press('ArrowLeft');
  await expect(slider).toHaveValue('1');
  await dialog.getByLabel('Instructions (optional)', { exact: true }).fill('Include the trigger Sema.');
  await expect(dialog.getByLabel('Instructions (optional)', { exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Add LoRA', exact: true })).toBeInViewport();
  const before = await positions();
  await dialog.getByRole('button', { name: 'Add LoRA', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Checking…', exact: true })).toBeDisabled();
  await expect(slider).toBeDisabled();
  expect(await positions()).toEqual(before);
  await dialog.screenshot({ path: `test-results/lora-checking-${width}.png` });
  finish(); await expect(dialog.getByRole('status')).toContainText('not available');
  expect(await positions()).toEqual(before);
  await dialog.screenshot({ path: `test-results/lora-error-${width}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.unroute('**/api/comfy/loras/resolve');
  await page.route('**/api/comfy/loras/resolve', route => { const body = route.request().postDataJSON(); return route.fulfill({ json: { ...body, name: body.address } }); });
  await dialog.getByRole('button', { name: 'Add LoRA', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(panel(page)).toContainText(filename);
  await expect(panel(page).getByRole('button', { name: 'Add LoRA', exact: true })).toBeDisabled();
  expect((await readProject(page)).loras).toEqual([{ model: 'h3', address: filename, name: filename, instructions: 'Include the trigger Sema.', strength: 1 }]);
  await panel(page).screenshot({ path: `test-results/project-loras-${width}.png` });
});

test('project assignments default new generations, persist, undo and never overwrite existing overrides', async ({ page }) => {
  await setup(page);
  let dialog = await addLora(page);
  await dialog.getByLabel('Instructions (optional)', { exact: true }).fill('Use the project trigger.');
  await dialog.getByRole('spinbutton', { name: 'LoRA strength value', exact: true }).fill('1.4');
  await dialog.getByRole('button', { name: 'Add LoRA', exact: true }).click();
  await expect(panel(page)).toContainText(filename);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(panel(page)).toContainText('No LoRAs yet');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(panel(page)).toContainText(filename);
  await addDraft(page, 'First'); await expect(selection(page)).toHaveValue(filename);
  await expect(strength(page)).toHaveValue('1.4');
  await selection(page).selectOption(''); await expect(page.locator('.generation-lora .lora-strength')).toHaveCount(0); await fitAll(page);
  dialog = await editLora(page); await dialog.getByLabel('Comfy Cloud model address', { exact: true }).fill(other);
  await dialog.getByRole('button', { name: 'Save LoRA', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect((await readProject(page)).interstitials[0].lora).toBeNull();
  await addDraft(page, 'Second'); await expect(selection(page)).toHaveValue(other);
  await expect(strength(page)).toHaveValue('1.4');
  await selection(page).selectOption('__custom__');
  const custom = page.getByRole('dialog', { name: 'Choose LoRA', exact: true });
  await custom.getByLabel('Comfy Cloud model address', { exact: true }).fill(filename);
  await custom.getByLabel('Instructions (optional)', { exact: true }).fill('Use the custom trigger.');
  await custom.getByRole('spinbutton', { name: 'LoRA strength value', exact: true }).fill('0.65');
  await custom.getByRole('button', { name: 'Use LoRA', exact: true }).click(); await expect(selection(page)).toHaveValue(filename);
  await expect(strength(page)).toHaveValue('0.65');
  expect((await readProject(page)).loras[0].address).toBe(other);
  await addQuestionTemplate(page);
  expect((await readProject(page)).interstitials.slice(-4).every((item: { lora: string; loraStrength: number }) => item.lora === other && item.loraStrength === 1.4)).toBe(true);
  await saveAndReopen(page); await fitAll(page);
  const saved = await readProject(page);
  expect(saved.loras[0].instructions).toBe('Use the project trigger.');
  expect(saved.loras[0].strength).toBe(1.4);
  expect(saved.interstitials[1].loraStrength).toBe(0.65);
  expect(saved.interstitials[1].loraInstructions).toBe('Use the custom trigger.');
  expect(saved.loras[0].address).toBe(other); expect(saved.interstitials[0].lora).toBeNull(); expect(saved.interstitials[1].lora).toBe(filename);
  await panel(page).getByRole('button', { name: 'Remove H3 LoRA', exact: true }).click();
  await expect(panel(page)).toContainText('No LoRAs yet'); await expect(panel(page).getByRole('button', { name: 'Add LoRA', exact: true })).toBeEnabled();
  await addDraft(page, 'No LoRA'); await expect(selection(page)).toHaveValue('');
  expect((await readProject(page)).interstitials[1].lora).toBe(filename);
});

test('generation submits the selected LoRA and cancellation of link validation never saves a late response', async ({ page }) => {
  await setup(page); const dialog = await addLora(page);
  let finish!: () => void, requested = false;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/comfy/loras/resolve', async route => { const body = route.request().postDataJSON(); requested = true; await gate; await route.fulfill({ json: { ...body, name: body.address } }).catch(() => {}); });
  await dialog.getByRole('button', { name: 'Add LoRA', exact: true }).click(); await expect.poll(() => requested).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); finish();
  await expect(panel(page)).toContainText('No LoRAs yet'); expect((await readProject(page)).loras ?? []).toEqual([]);
  await page.unroute('**/api/comfy/loras/resolve');
  await page.route('**/api/comfy/loras/resolve', route => { const body = route.request().postDataJSON(); return route.fulfill({ json: { ...body, name: body.address } }); });
  const retry = await addLora(page); await retry.getByRole('button', { name: 'Add LoRA', exact: true }).click(); await expect(retry).toHaveCount(0);
  await addDraft(page); await page.getByLabel('Video prompt', { exact: true }).fill('A character waves');
  await page.route('**/api/comfy/status*', route => route.fulfill({ json: { ready: true } }));
  let submitted = '';
  await page.route('**/api/comfy/interstitials', route => { submitted = route.request().postData() ?? ''; return route.fulfill({ status: 503, json: { error: 'Test stopped before a paid generation.' } }); });
  await page.getByRole('slider', { name: 'LoRA strength', exact: true }).press('Home');
  await expect(strength(page)).toHaveValue('0');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect.poll(() => submitted).toContain(filename);
  expect(submitted).toContain('name="lora"');
  expect(submitted).toMatch(/name="loraStrength"\r?\n\r?\n0\r?\n/);
  expect((await readProject(page)).interstitials[0].generationSettings.loraStrength).toBe(0);
  await strength(page).fill('1.25');
  expect((await readProject(page)).interstitials[0].generationSettings.loraStrength).toBe(0);
  expect((await readProject(page)).interstitials[0].generationSettings.lora).toBe(filename);
});


test('enhancement uses the selected LoRA instructions and ignores late results after changing LoRAs', async ({ page }) => {
  await setup(page);
  let dialog = await addLora(page);
  await dialog.getByLabel('Instructions (optional)', { exact: true }).fill('Name Sema in the prompt.');
  await dialog.getByRole('button', { name: 'Add LoRA', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await addDraft(page, 'Instructions');
  const prompt = page.getByLabel('Video prompt', { exact: true });
  await prompt.fill('She waves.');
  const bodies: { prompt: string; loraInstructions?: string }[] = [];
  await page.route('**/api/interstitials/enhance-prompt', route => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { prompt: `Enhanced ${bodies.length}`, model: 'test-model' } });
  });
  const enhance = async () => {
    const count = bodies.length + 1;
    await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
    await expect(prompt).toHaveValue(`Enhanced ${count}`);
    await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeEnabled();
  };
  await enhance(); expect(bodies.at(-1)).toMatchObject({ prompt: 'She waves.', loraInstructions: 'Name Sema in the prompt.' });
  // Project instruction edits apply to an existing generation using that assignment.
  await fitAll(page); dialog = await editLora(page);
  await expect(dialog.getByLabel('Instructions (optional)', { exact: true })).toHaveValue('Name Sema in the prompt.');
  await dialog.getByLabel('Instructions (optional)', { exact: true }).fill('Name Sema and preserve her costume.');
  await dialog.getByRole('spinbutton', { name: 'LoRA strength value', exact: true }).fill('0');
  await dialog.getByRole('button', { name: 'Save LoRA', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator('.story-clip.type-simple .story-clip-title').click();
  await expect(strength(page)).toHaveValue('1');
  await enhance(); expect(bodies.at(-1)?.loraInstructions).toBe('Name Sema and preserve her costume.');
  await selection(page).selectOption('__custom__');
  dialog = page.getByRole('dialog', { name: 'Choose LoRA', exact: true });
  await dialog.getByLabel('Comfy Cloud model address', { exact: true }).fill(other);
  await dialog.getByLabel('Instructions (optional)', { exact: true }).fill('Use the alternate trigger.');
  await dialog.getByRole('button', { name: 'Use LoRA', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await enhance(); expect(bodies.at(-1)?.loraInstructions).toBe('Use the alternate trigger.');
  await selection(page).selectOption('');
  await enhance(); expect(bodies.at(-1)).not.toHaveProperty('loraInstructions');
  await selection(page).selectOption(filename);
  await expect(strength(page)).toHaveValue('0');
  await enhance(); expect(bodies.at(-1)?.loraInstructions).toBe('Name Sema and preserve her costume.');
  let finish!: () => void, requested = false;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/interstitials/enhance-prompt', async route => {
    requested = true; await waiting;
    await route.fulfill({ json: { prompt: 'Stale result', model: 'test-model' } }).catch(() => {});
  });
  const before = await prompt.inputValue();
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await selection(page).selectOption('');
  await expect(page.getByRole('button', { name: 'Enhance prompt', exact: true })).toBeEnabled();
  finish(); await expect(prompt).toHaveValue(before);
  await addDraft(page, 'New default strength');
  await expect(strength(page)).toHaveValue('0');
});
