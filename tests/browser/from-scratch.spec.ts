import { test, expect, addDraft, readProject, saveAndReopen } from './fixtures';

for (const width of [1440, 390]) for (const loop of [false, true]) for (const conditional of [false, true]) {
  test(`create from scratch: loop ${loop}, conditional ${conditional}, ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/status', async route => { const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { comfy: true, openai: false, gemini: false } } }); });
    await page.route('**/api/comfy/status*', route => route.fulfill({ json: { ready: true } }));
    let submitted = 0, complete = false, fail = false;
    await page.route('**/api/comfy/interstitials', async route => {
      const form = await new Response(Uint8Array.from(route.request().postDataBuffer()!), { headers: { 'Content-Type': route.request().headers()['content-type'] } }).formData();
      expect(form.has('video')).toBe(false); expect(form.has('imageReferences')).toBe(false);
      expect(form.has('startImageIndex')).toBe(false); expect(form.has('endImageIndex')).toBe(false);
      expect(form.get('before')).toBe('0'); expect(form.get('after')).toBe('0');
      expect(form.get('width')).toBe('1280'); expect(form.get('height')).toBe('736');
      expect(form.get('mode')).toBe(loop ? 'loop' : 'custom');
      if (loop) expect(form.get('loopImageGuide')).toBe('false');
      submitted++;
      await route.fulfill({ status: 202, json: { requestId: 'scratch-test-job', status: 'IN_QUEUE', insertion: { start: 0, duration: 4, totalDuration: 4 } } });
    });
    await page.route('**/api/comfy/jobs/scratch-test-job/events', route => route.fulfill({ contentType: 'text/event-stream', body: 'event: progress\ndata: {"type":"progress","progressDetails":{"stage":"Generating video"}}\n\n' }));
    await page.route('**/api/comfy/jobs/scratch-test-job', route => route.fulfill(fail ? { status: 500, json: { error: 'Test generation failed' } } : { json: complete
      ? { requestId: 'scratch-test-job', status: 'COMPLETED', videoUrl: 'https://example.test/scratch.mp4' }
      : { requestId: 'scratch-test-job', status: 'IN_PROGRESS' } }));
    await page.route('https://example.test/scratch.mp4', route => route.fulfill({ contentType: 'video/mp4', path: 'tests/fixtures/interstitial-reference.mp4' }));
    await page.goto('/'); await page.getByRole('button', { name: /^New project/ }).click(); await addDraft(page);
    if (loop) await page.getByRole('checkbox', { name: 'Loop', exact: true }).check();
    if (conditional) await page.getByRole('checkbox', { name: 'Conditional', exact: true }).check();
    for (const side of loop ? ['Loop'] : ['Start', 'End']) await expect(page.getByRole('group', { name: `${side} reference`, exact: true }).getByRole('button', { name: 'None', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const prompt = page.getByLabel('Interstitial prompt', { exact: true }); await prompt.fill('Clouds drift gently across a sunset sky.');
    const controls = () => page.locator('.interstitial-editor').evaluate(root => {
      const top = root.getBoundingClientRect().top;
      return ['textarea', '.inspector-references-panel', '.interstitial-resolution', '.interstitial-time-fields', 'button[type=submit]', '.task-status', '.inspector-output'].map(selector => {
        const rect = root.querySelector(selector)!.getBoundingClientRect(); return { top: rect.top - top, height: rect.height };
      });
    });
    const idle = await controls();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect.poll(() => submitted).toBe(1); expect(await controls()).toEqual(idle);
    fail = true; await expect(page.locator('.task-status')).toContainText('Test generation failed'); expect(await controls()).toEqual(idle);
    fail = false; complete = true; await page.getByRole('button', { name: 'Check result', exact: true }).click();
    await expect.poll(async () => (await readProject(page)).interstitials[0].phase, { timeout: 60_000 }).toBe('ready');
    expect(submitted).toBe(1); expect(await controls()).toEqual(idle);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
    await page.locator('.clip-inspector').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/from-scratch-${loop}-${conditional}-${width}.png` });
    if (loop && conditional) {
      await saveAndReopen(page); await page.locator('.story-clip-title').click();
      const project = await readProject(page);
      expect(project.storyFlow.nodes[0]).toMatchObject({ loop: true, conditional: true });
      expect(project.interstitials[0].generationSettings).toMatchObject({ startReferenceType: 'none', useInputReference: false, useOutputReference: false });
      await expect(page.getByRole('group', { name: 'Loop reference', exact: true }).getByRole('button', { name: 'None', exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
  });
}
