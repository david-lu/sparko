import { addDraft, addQuestionTemplate, expect, fitAll, openVideo, readProject, saveAndReopen, test, type Page } from './fixtures';

const filename = 'iris-animation__h3_character.safetensors';
const other = 'iris-animation__h3_other.safetensors';
const panel = (page: Page) => page.getByRole('region', { name: 'Project LoRAs', exact: true });
const selection = (page: Page) => page.getByLabel('Generation LoRA', { exact: true });
async function setup(page: Page) {
  await page.route('**/api/status', async route => { const response = await route.fetch(); const status = await response.json(); await route.fulfill({ json: { ...status, providers: { ...status.providers, comfy: true } } }); });
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

for (const width of [1440, 390]) test(`LoRA dialog is stable while checking and on failure at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await setup(page);
  const dialog = await addLora(page);
  let finish!: () => void, requested = false;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/comfy/loras/resolve', async route => { requested = true; await gate; await route.fulfill({ status: 400, json: { error: 'This LoRA is not available in your Comfy Cloud account. Import it there first, then paste its exact model filename.' } }); });
  const positions = () => dialog.evaluate(element => ['.lora-model-trigger', 'input', '.close-project-actions'].map(selector => {
    const box = element.querySelector(selector)!.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  const before = await positions();
  await dialog.getByRole('button', { name: 'Add LoRA', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Checking…', exact: true })).toBeDisabled();
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
  expect((await readProject(page)).loras).toEqual([{ model: 'h3', address: filename, name: filename }]);
  await panel(page).screenshot({ path: `test-results/project-loras-${width}.png` });
});

test('project assignments default new generations, persist, undo and never overwrite existing overrides', async ({ page }) => {
  await setup(page);
  let dialog = await addLora(page); await dialog.getByRole('button', { name: 'Add LoRA', exact: true }).click();
  await expect(panel(page)).toContainText(filename);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(panel(page)).toContainText('No LoRAs yet');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(panel(page)).toContainText(filename);
  await addDraft(page, 'First'); await expect(selection(page)).toHaveValue(filename);
  await selection(page).selectOption(''); await fitAll(page);
  dialog = await editLora(page); await dialog.getByLabel('Comfy Cloud model address', { exact: true }).fill(other);
  await dialog.getByRole('button', { name: 'Save LoRA', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect((await readProject(page)).interstitials[0].lora).toBeNull();
  await addDraft(page, 'Second'); await expect(selection(page)).toHaveValue(other);
  await selection(page).selectOption('__custom__');
  const custom = page.getByRole('dialog', { name: 'Choose LoRA', exact: true });
  await custom.getByLabel('Comfy Cloud model address', { exact: true }).fill(filename);
  await custom.getByRole('button', { name: 'Use LoRA', exact: true }).click(); await expect(selection(page)).toHaveValue(filename);
  expect((await readProject(page)).loras[0].address).toBe(other);
  await addQuestionTemplate(page);
  expect((await readProject(page)).interstitials.slice(-4).every((item: { lora: string }) => item.lora === other)).toBe(true);
  await saveAndReopen(page); await fitAll(page);
  const saved = await readProject(page);
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
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect.poll(() => submitted).toContain(filename);
  expect(submitted).toContain('name="lora"');
  expect((await readProject(page)).interstitials[0].generationSettings.lora).toBe(filename);
});
