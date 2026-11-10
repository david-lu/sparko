import { expect, openVideo, readProject, test, type Page } from './fixtures';

const voices = [
  { id: 'VoiceAria0001', name: 'Aria', labels: { accent: 'american', age: 'young', gender: 'female' } },
  { id: 'VoiceRoger001', name: 'Roger', labels: { accent: 'british', age: 'middle_aged', gender: 'male' } },
];
async function setup(page: Page) {
  await page.route('**/api/status', async route => { const response = await route.fetch(), body = await response.json(); await route.fulfill({ json: { ...body, providers: { ...body.providers, elevenlabs: true, openai: true } } }); });
  await page.route('**/api/elevenlabs/voices?*', route => { const search = new URL(route.request().url()).searchParams.get('search')?.toLowerCase() ?? '';
    return route.fulfill({ json: { voices: voices.filter(voice => voice.name.toLowerCase().includes(search)) } }); });
  await openVideo(page);
}
const section = (page: Page) => page.getByRole('region', { name: 'Project characters', exact: true });
async function addCharacter(page: Page, name: string, description: string, voice: string) {
  await section(page).getByRole('button', { name: 'Add character', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('How they sound', { exact: true }).fill(description);
  await dialog.getByLabel('Search ElevenLabs voices', { exact: true }).fill(voice);
  await dialog.getByRole('button', { name: new RegExp(`^${voice}`) }).click();
  await dialog.getByRole('button', { name: 'Add character', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('characters give dialogue its voices and inform audio prompt enhancement', async ({ page }) => {
  await setup(page);
  await addCharacter(page, 'Mara', 'Low, husky and wry; never shouts.', 'Aria');
  await addCharacter(page, 'Theo', 'Nervous teenager, quick and breathy.', 'Roger');
  await expect(section(page).getByRole('listitem')).toHaveText([/Mara.*Voice: Aria/, /Theo.*Voice: Roger/]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(section(page).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(section(page).getByRole('listitem')).toHaveCount(2);

  await page.getByRole('button', { name: 'Add audio', exact: true }).press('Enter');
  const prompt = page.getByLabel('Generation prompt', { exact: true });
  await expect(page.getByLabel('Generation model', { exact: true })).toHaveValue('elevenlabs-dialogue');
  await page.getByRole('button', { name: 'Insert Mara', exact: true }).click(); await page.keyboard.type('Did you hear that?');
  await page.getByRole('button', { name: 'Insert Theo', exact: true }).click(); await page.keyboard.type('Just the wind.');
  await expect(prompt).toHaveValue('Mara: Did you hear that?\nTheo: Just the wind.');
  await prompt.press('End'); await page.keyboard.type('\nIris: Hello?');
  await expect(page.getByRole('status').filter({ hasText: 'No character is named “Iris”' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate audio', exact: true })).toBeDisabled();
  await prompt.fill('Mara: Did you hear that?\nTheo: Just the wind.');

  const enhancements: any[] = [];
  await page.route('**/api/audio-prompts/enhance', route => { const body = route.request().postDataJSON(); enhancements.push(body);
    return route.fulfill({ json: { prompt: 'Mara: [whispers] Did you hear that?\nTheo: [nervously] Just… the wind.', model: body.settings.model } }); });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect(page.getByLabel('Enhanced prompt', { exact: true })).toHaveValue('Mara: [whispers] Did you hear that?\nTheo: [nervously] Just… the wind.');
  expect(enhancements[0].characters).toEqual([{ name: 'Mara', voiceDescription: 'Low, husky and wry; never shouts.', voiceName: 'Aria' }, { name: 'Theo', voiceDescription: 'Nervous teenager, quick and breathy.', voiceName: 'Roger' }]);
  expect(JSON.stringify(enhancements[0])).not.toContain('VoiceAria0001');

  const generations: any[] = [];
  await page.route('**/api/elevenlabs/audio', route => { generations.push(route.request().postDataJSON()); return route.fulfill({ contentType: 'audio/wav', path: 'tests/fixtures/voice-answer.wav' }); });
  await page.getByLabel('Dialogue stability', { exact: true }).selectOption({ label: 'Creative' });
  await page.getByRole('button', { name: 'Generate audio', exact: true }).click();
  await expect.poll(async () => (await readProject(page)).clipGenerations.find((g: any) => g.kind === 'audio')?.phase).toBe('ready');
  expect(generations[0].settings).toMatchObject({ model: 'elevenlabs-dialogue', useEnhancedPrompt: true, stability: 0, dialogueVoices: [
    { speaker: 'Mara', voiceId: 'VoiceAria0001', voiceName: 'Aria' }, { speaker: 'Theo', voiceId: 'VoiceRoger001', voiceName: 'Roger' }] });
  expect((await readProject(page)).characters.map((c: any) => c.name)).toEqual(['Mara', 'Theo']);
});

for (const width of [1440, 390]) test(`character voice design keeps a stable dialog layout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width <= 390 ? 740 : 1000 }); await setup(page);
  let finishDesign!: () => void; const designed = new Promise<void>(resolve => { finishDesign = resolve; });
  await page.route('**/api/elevenlabs/voices/design', async route => { await designed; await route.fulfill({ json: { previews: [1, 2, 3].map(n => ({ generatedVoiceId: `generated_${n}abc`, audio: 'data:audio/wav;base64,UklGRg==', duration: 4 })) } }); });
  const saved: any[] = [];
  await page.route('**/api/elevenlabs/voices', route => { saved.push(route.request().postDataJSON()); return route.fulfill({ json: { id: 'VoiceGrom0001', name: 'Grom' } }); });
  await section(page).getByRole('button', { name: 'Add character', exact: true }).click();
  const dialog = page.getByRole('dialog'), list = dialog.locator('.character-voice-list');
  await dialog.getByLabel('Name', { exact: true }).fill('Grom');
  await dialog.getByRole('button', { name: 'Design voice', exact: true }).click();
  const design = dialog.getByRole('button', { name: 'Design voices from description', exact: true });
  await expect(design).toBeDisabled();
  await dialog.getByLabel('How they sound', { exact: true }).fill('A huge cave troll with a booming, gravelly voice and slow, deliberate pacing.');
  const before = await list.boundingBox();
  await design.click();
  await expect(dialog.getByRole('button', { name: 'Designing voices…', exact: true })).toBeVisible();
  const during = await list.boundingBox();
  finishDesign();
  await dialog.getByRole('button', { name: /^Designed voice 2/ }).click();
  const after = await list.boundingBox();
  for (const box of [during, after]) expect(box).toEqual(before);
  const form = await dialog.locator('form').boundingBox();
  expect(form!.x).toBeGreaterThanOrEqual(0); expect(form!.x + form!.width).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await dialog.screenshot({ path: `test-results/character-dialog-${width}.png` });
  await dialog.getByRole('button', { name: 'Add character', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved).toEqual([{ name: 'Grom', description: 'A huge cave troll with a booming, gravelly voice and slow, deliberate pacing.', generatedVoiceId: 'generated_2abc' }]);
  await expect(section(page).getByRole('listitem')).toHaveText([/Grom.*Voice: Grom/]);
});
