import { setVideoReference, test, expect, openVideo, addQuestionTemplate, readProject } from './fixtures';

test('each template prompt enhances independently without submitting a generation', async ({ page }) => {
  await page.route('**/api/status', async route => { const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { openai: true, comfy: true } } }); });
  await openVideo(page); await addQuestionTemplate(page);
  let requests = 0, generations = 0;
  await page.route('**/api/comfy/interstitials', route => { generations++; return route.abort(); });
  await page.route('**/api/interstitials/enhance-prompt', route => {
    const body = route.request().postDataJSON(); expect(body.prompt).toBeTruthy(); requests++;
    return route.fulfill({ json: { prompt: `Enhanced prompt ${requests}`, model: 'test' } });
  });
  for (const [index, name] of ['Ask a question', 'Wait for the viewer', 'Celebrate', 'Encourage'].entries()) {
    await page.locator('.story-clip-title').filter({ hasText: name }).click();
    // Draft predecessors have no media yet. Text-only enhancement is still available.
    if (name === 'Wait for the viewer') await setVideoReference(page, 'start', false);
    else {
      await setVideoReference(page, 'start', false);
      await setVideoReference(page, 'end', false);
    }
    await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
    await expect(page.getByLabel('Enhanced prompt', { exact: true })).toHaveValue(`Enhanced prompt ${index + 1}`);
  }
  expect((await readProject(page)).interstitials.map((item: any) => item.enhancedPrompt)).toEqual([1, 2, 3, 4].map(i => `Enhanced prompt ${i}`));
  expect(generations).toBe(0);
});
