import { test, expect } from './fixtures';

test('compact inspector uses connected references, supports all switch combinations, and keeps progress in place', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/status', async route => { const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { openai: false, gemini: false, comfy: true } } }); });
  await page.route('**/api/comfy/status', route => route.fulfill({ json: { ready: true } }));
  const submitted: { before: number; after: number; uploaded: boolean }[] = [];
  await page.route('**/api/comfy/interstitials', async route => {
    const form = await new Response(Uint8Array.from(route.request().postDataBuffer()!), { headers: { 'Content-Type': route.request().headers()['content-type'] } }).formData();
    submitted.push({ before: Number(form.get('before')), after: Number(form.get('after')), uploaded: !!form.get('video') });
    await route.fulfill({ status: 202, json: { requestId: 'inspector-test-job', status: 'IN_QUEUE', insertion: { start: 0, duration: 6, totalDuration: 6 } } });
  });
  await page.route('**/api/comfy/jobs/inspector-test-job', route => route.fulfill({ json: { requestId: 'inspector-test-job', status: route.request().method() === 'DELETE' ? 'CANCELLED' : 'IN_PROGRESS', progress: .5 } }));
  await page.route('**/api/comfy/jobs/inspector-test-job/events', route => route.fulfill({ contentType: 'text/event-stream', body: 'event: progress\ndata: {"type":"progress","progress":0.5,"progressDetails":{"stage":"Generating","step":1,"steps":2}}\n\n' }));
  await page.goto('/'); await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.story-clip')).toHaveCount(1, { timeout: 60000 });
  await page.getByRole('slider', { name: /Scrub/ }).focus(); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('s');
  await page.getByRole('button', { name: 'Add interstitial', exact: true }).dragTo(page.getByRole('button', { name: /Edit crossfade from/ }));
  const inspector = page.locator('.clip-inspector');
  await expect(inspector.getByRole('combobox')).toHaveCount(0); // Routing stays collapsed; references have switches, not pickers.
  await expect(page.getByRole('checkbox', { name: 'Loop', exact: true })).not.toBeChecked(); await expect(page.getByRole('checkbox', { name: 'Conditional', exact: true })).not.toBeChecked();
  await page.getByLabel('Interstitial prompt', { exact: true }).fill('Continue the camera move.');
  const bounds = () => inspector.evaluate(root => {
    const top = root.getBoundingClientRect().top;
    return ['.inspector-prompt', '.interstitial-time-fields', 'button[type=submit]', '.task-status', '.inspector-output', '.inspector-group:last-of-type'].map(s => {
      const r = root.querySelector(s)!.getBoundingClientRect(); return { y: r.top - top, height: r.height };
    });
  });
  const button = await inspector.locator('button[type=submit]').boundingBox(), panel = await inspector.boundingBox();
  expect(button!.y + button!.height - panel!.y).toBeLessThan(380); // Two independent behavior subsection headers.
  await page.screenshot({ path: 'test-results/inspector-compact-desktop.png', fullPage: true });
  const settings = [[true, false], [true, true], [false, true], [false, false]];
  for (const [index, [input, output]] of settings.entries()) {
    if (index === 2) await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('checkbox', { name: 'Use input reference' }).setChecked(input);
    await page.getByRole('checkbox', { name: 'Use output reference' }).setChecked(output);
    const inputRow = page.getByRole('group', { name: 'Input reference', exact: true }), outputRow = page.getByRole('group', { name: 'Output reference', exact: true });
    expect(await inputRow.getByRole('spinbutton', { name: 'start_range' }).isEnabled()).toBe(input);
    expect(await outputRow.getByRole('spinbutton', { name: 'end_range' }).isEnabled()).toBe(output);
    const before = await bounds();
    await inspector.locator('button[type=submit]').click(); await expect.poll(() => submitted.length, { timeout: 60000 }).toBe(index + 1);
    expect(submitted[index]).toEqual({ before: input ? 1.625 : 0, after: output ? 1.625 : 0, uploaded: input || output });
    expect(await bounds()).toEqual(before);
    const reference = await page.evaluate(async () => { const { readActiveProject } = await import('/src/features/project/database.ts' as string); return (await readActiveProject())!.interstitials[0].requestReference; });
    expect(!!reference.before).toBe(input); expect(!!reference.after).toBe(output);
    await page.getByRole('button', { name: 'Cancel interstitial generation' }).click();
    await expect(inspector.locator('button[type=submit]')).toHaveText('Retry'); expect(await bounds()).toEqual(before);
  }
  await page.screenshot({ path: 'test-results/inspector-compact-mobile.png', fullPage: true });
  await page.locator('.inspector-advanced>summary').click(); await expect(page.getByRole('button', { name: /^Mask injection:/ })).toBeVisible();
  await page.getByRole('button', { name: 'Generation details', exact: true }).click(); await expect(page.locator('.inspector-status-popover:popover-open')).toContainText('without reference footage'); await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
