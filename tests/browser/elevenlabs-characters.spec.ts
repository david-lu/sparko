import { addDraft, expect, openVideo, readProject, showImageReferences, test, type Page } from './fixtures';

const voices = [
  { id: 'VoiceAria0001', name: 'Aria', labels: { accent: 'american', age: 'young', gender: 'female' } },
  { id: 'VoiceRoger001', name: 'Roger', labels: { accent: 'british', age: 'middle_aged', gender: 'male' } },
];
async function setup(page: Page) {
  await page.route('**/api/status', async route => { const response = await route.fetch(), body = await response.json(); await route.fulfill({ json: { ...body, providers: { ...body.providers, elevenlabs: true, openai: true, fal: true } } }); });
  await page.route('**/api/elevenlabs/voices?*', route => { const search = new URL(route.request().url()).searchParams.get('search')?.toLowerCase() ?? '';
    return route.fulfill({ json: { voices: voices.filter(voice => voice.name.toLowerCase().includes(search)) } }); });
  await openVideo(page);
}
const workspace = (page: Page) => page.locator('.character-workspace');
const summary = (page: Page) => page.getByRole('region', { name: 'Project characters', exact: true });
async function png(page: Page, color: string) {
  return Buffer.from(await page.evaluate(fill => { const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = fill; ctx.fillRect(0, 0, 64, 64); return canvas.toDataURL('image/png').split(',')[1]; }, color), 'base64');
}
/** Adds a character from Project settings: name, how they sound and look, a voice and optionally a reference image. */
async function addCharacter(page: Page, name: string, { sound, look, voice, image }: { sound: string; look: string; voice: string; image?: Buffer }) {
  await summary(page).getByRole('button', { name: 'Add character', exact: true }).click();
  const form = workspace(page);
  await expect(form.getByRole('heading', { name: 'Add character', exact: true })).toBeVisible();
  await expect(form.getByLabel('Name', { exact: true })).toBeFocused();
  await page.keyboard.type(name);
  await form.getByLabel('How they sound', { exact: true }).fill(sound);
  await form.getByLabel('How they look', { exact: true }).fill(look);
  await form.getByLabel('Search ElevenLabs voices', { exact: true }).fill(voice);
  await form.getByRole('button', { name: new RegExp(`^${voice}`) }).click();
  await expect(form.getByRole('group', { name: 'Character voice', exact: true })).toContainText(`ElevenLabs voice: ${voice}`);
  if (image) await form.getByLabel('Upload Character reference images', { exact: true }).setInputFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: image });
  if (image) await expect(form.locator('.character-images .asset-reference-chip')).toHaveCount(1);
  // Nothing is saved until the character is added.
  expect((await readProject(page)).characters?.some((c: any) => c.name === name)).toBeFalsy();
  await form.getByRole('button', { name: 'Add character', exact: true }).click();
  await expect(form.getByRole('heading', { name: `Edit ${name}`, exact: true })).toBeVisible();
  await expect(form.getByRole('status').filter({ hasText: `${name} added.` })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
}

test('characters are added and edited in a workspace that replaces the player and timeline, then speak dialogue', async ({ page }) => {
  await setup(page);
  await addCharacter(page, 'Mara', { sound: 'Low, husky and wry; never shouts.', look: 'Red coat, short silver hair.', voice: 'Aria' });
  await expect(page.locator('.video-stage')).toBeHidden(); await expect(page.locator('.story-canvas')).toBeHidden();
  await addCharacter(page, 'Theo', { sound: 'Nervous teenager, quick and breathy.', look: 'Tall and freckled.', voice: 'Roger' });
  const rows = summary(page).getByRole('button', { name: /^Edit / });
  await expect(rows).toHaveText([/Mara.*Voice: Aria/, /Theo.*Voice: Roger/]);
  await expect(summary(page).getByRole('button', { name: 'Edit Theo', exact: true })).toHaveAttribute('aria-current', 'true');

  // Unsaved changes are kept until saved, and switching characters asks first.
  await summary(page).getByRole('button', { name: 'Edit Mara', exact: true }).click();
  await expect(workspace(page).getByRole('heading', { name: 'Edit Mara', exact: true })).toBeVisible();
  await workspace(page).getByLabel('How they look', { exact: true }).fill('Red coat, short silver hair, round glasses.');
  await summary(page).getByRole('button', { name: 'Edit Theo', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await discard.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(workspace(page).getByLabel('How they look', { exact: true })).toHaveValue('Red coat, short silver hair, round glasses.');
  await expect(summary(page).getByRole('button', { name: 'Edit Mara', exact: true })).toHaveAttribute('aria-current', 'true');
  expect((await readProject(page)).characters[0].visualDescription).toBe('Red coat, short silver hair.');
  await workspace(page).getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(workspace(page).getByRole('status').filter({ hasText: 'Changes saved.' })).toBeVisible();
  expect((await readProject(page)).characters[0].visualDescription).toBe('Red coat, short silver hair, round glasses.');

  // Characters are removed from the inspector, undoably; removing the one being edited closes the workspace.
  await summary(page).getByRole('button', { name: 'Remove Mara', exact: true }).click();
  await expect(workspace(page)).toHaveCount(0); await expect(page.locator('.story-canvas')).toBeVisible();
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(rows).toHaveText([/Mara/, /Theo/]);

  await page.getByRole('button', { name: 'Add audio', exact: true }).press('Enter');
  const prompt = page.getByLabel('Generation prompt', { exact: true }), speaker = page.getByRole('group', { name: 'Speaker', exact: true });
  await expect(page.getByLabel('Generation model', { exact: true })).toHaveValue('elevenlabs-dialogue');
  await prompt.fill('Did you hear that, Theo?');
  await expect(page.getByRole('status').filter({ hasText: 'Choose the character who speaks.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate audio', exact: true })).toBeDisabled();
  await speaker.getByRole('button', { name: 'Use Theo', exact: true }).click();
  await speaker.getByRole('button', { name: 'Use Mara', exact: true }).click();
  // One speaker at a time: choosing Mara replaces Theo.
  await expect(speaker.getByRole('button', { name: 'Use Theo', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(speaker.getByRole('button', { name: 'Use Mara', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const enhancements: any[] = [];
  await page.route('**/api/audio-prompts/enhance', route => { const body = route.request().postDataJSON(); enhancements.push(body);
    return route.fulfill({ json: { prompt: '[whispers] Did you hear that, Theo?', model: body.settings.model } }); });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect(page.getByLabel('Enhanced prompt', { exact: true })).toHaveValue('[whispers] Did you hear that, Theo?');
  expect(enhancements[0].characters).toEqual([{ name: 'Mara', voiceDescription: 'Low, husky and wry; never shouts.', voiceName: 'Aria', visualDescription: 'Red coat, short silver hair, round glasses.' }]);
  expect(JSON.stringify(enhancements[0])).not.toContain('VoiceAria0001');

  const generations: any[] = [];
  await page.route('**/api/elevenlabs/audio', route => { generations.push(route.request().postDataJSON()); return route.fulfill({ contentType: 'audio/wav', path: 'tests/fixtures/voice-answer.wav' }); });
  await page.getByLabel('Dialogue stability', { exact: true }).selectOption({ label: 'Creative' });
  await page.getByRole('button', { name: 'Generate audio', exact: true }).click();
  await expect.poll(async () => (await readProject(page)).clipGenerations.find((g: any) => g.kind === 'audio')?.phase).toBe('ready');
  expect(generations[0].settings).toMatchObject({ model: 'elevenlabs-dialogue', useEnhancedPrompt: true, stability: 0, dialogueVoices: [{ speaker: 'Mara', voiceId: 'VoiceAria0001', voiceName: 'Aria' }] });

  // Sound effects use the selected characters' voices as context.
  await page.getByLabel('Generation model', { exact: true }).selectOption('elevenlabs-sound-effects');
  // Switching models keeps the selection: the speaker stays selected.
  await expect(page.getByRole('group', { name: 'Characters', exact: true }).getByRole('button', { name: 'Use Mara', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: 'Characters', exact: true }).getByRole('button', { name: 'Use Mara', exact: true }).click();
  await page.getByRole('group', { name: 'Characters', exact: true }).getByRole('button', { name: 'Use Theo', exact: true }).click();
  await prompt.fill('Theo laughs nervously while Mara sighs');
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect.poll(() => enhancements.length).toBe(2);
  // Selected characters come first, then characters the prompt names.
  expect(enhancements[1].characters.map((c: any) => c.name)).toEqual(['Theo', 'Mara']);
});

test('characters supply reference images to image and H3 video generation', async ({ page }) => {
  await setup(page);
  await addCharacter(page, 'Mara', { sound: 'Low and husky.', look: 'Red coat, short silver hair.', voice: 'Aria', image: await png(page, '#b33') });
  await workspace(page).getByRole('button', { name: 'Close characters', exact: true }).click();
  await expect(workspace(page)).toHaveCount(0);
  const mara = (await readProject(page)).characters[0], imageId = mara.images[0].assetId;

  await page.getByRole('button', { name: 'Add image', exact: true }).press('Enter');
  await page.getByLabel('Generation prompt', { exact: true }).fill('Mara reading in a café');
  const characters = page.getByRole('group', { name: 'Characters', exact: true });
  await characters.getByRole('button', { name: 'Use Mara', exact: true }).click();
  await expect(characters.getByRole('button', { name: 'Use Mara', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Adds 1 character reference image after your references.')).toBeVisible();
  const imageEnhancements: any[] = [];
  await page.route('**/api/image-prompts/enhance', route => { const body = route.request().postDataJSON(); imageEnhancements.push(body); return route.fulfill({ json: { prompt: 'A woman in a red coat reads.', model: body.settings.model } }); });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).click();
  await expect(page.getByLabel('Enhanced prompt', { exact: true })).toHaveValue('A woman in a red coat reads.');
  expect(imageEnhancements[0].settings.references).toEqual([{ assetId: imageId, name: 'Mara', kind: 'image' }]);
  expect(imageEnhancements[0].images).toHaveLength(1);
  expect(imageEnhancements[0].characters).toEqual([{ name: 'Mara', visualDescription: 'Red coat, short silver hair.', images: [1] }]);
  const submissions: any[] = [];
  await page.route('**/api/library-generations', route => { submissions.push(route.request().postDataJSON()); return route.fulfill({ status: 503, json: { error: 'Stopped by the test.' } }); });
  await page.getByRole('button', { name: 'Generate image', exact: true }).click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0].settings.references).toEqual([{ assetId: imageId, name: 'Mara', kind: 'image' }]);
  expect(submissions[0].inputs).toHaveLength(1);
  expect((await readProject(page)).clipGenerations.find((g: any) => g.kind === 'image').settings).toMatchObject({ references: [], characterIds: [mara.id] });

  await addDraft(page, 'Scene');
  await page.getByLabel('Video prompt', { exact: true }).fill('Mara waves at the camera.');
  const images = await showImageReferences(page);
  await images.getByRole('button', { name: 'Use Mara', exact: true }).click();
  await expect(images.getByText('<Picture 1>')).toBeVisible();
  const videoEnhancements: any[] = [];
  await page.route('**/api/interstitials/enhance-prompt', route => { videoEnhancements.push(route.request().postDataJSON()); return route.fulfill({ json: { prompt: 'She waves.', model: 'test-model' } }); });
  await page.getByRole('button', { name: 'Enhance prompt', exact: true }).first().click();
  await expect.poll(() => videoEnhancements.length).toBe(1);
  expect(videoEnhancements[0].characters).toEqual([{ name: 'Mara', voiceDescription: 'Low and husky.', voiceName: 'Aria', visualDescription: 'Red coat, short silver hair.', images: [1] }]);
  const item = (await readProject(page)).interstitials.find((i: any) => i.imageReferences?.length);
  expect(item.imageReferences).toEqual([{ assetId: imageId, name: 'Mara', characterId: mara.id }]);
});
for (const width of [1440, 390]) test(`the Characters workspace keeps its actions at the bottom and a stable layout while designing a voice at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width <= 390 ? 740 : 1000 }); await setup(page);
  let finishDesign!: () => void; const designed = new Promise<void>(resolve => { finishDesign = resolve; });
  await page.route('**/api/elevenlabs/voices/design', async route => { await designed; await route.fulfill({ json: { previews: [1, 2, 3].map(n => ({ generatedVoiceId: `generated_${n}abc`, audio: 'data:audio/wav;base64,UklGRg==', duration: 4 })) } }); });
  const saved: any[] = [];
  await page.route('**/api/elevenlabs/voices', route => { saved.push(route.request().postDataJSON()); return route.fulfill({ json: { id: 'VoiceGrom0001', name: 'Grom' } }); });
  await summary(page).getByRole('button', { name: 'Add character', exact: true }).click();
  const form = workspace(page), list = form.locator('.character-voice-list'), actions = form.locator('.character-workspace-footer');
  await expect(actions.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Remove character' })).toHaveCount(0);
  await page.keyboard.type('Grom');
  await form.getByRole('button', { name: 'Design voice', exact: true }).click();
  const design = form.getByRole('button', { name: 'Design voices from “How they sound”', exact: true });
  await expect(design).toBeDisabled();
  await form.getByLabel('How they sound', { exact: true }).fill('A huge cave troll with a booming, gravelly voice and slow, deliberate pacing.');
  const before = await list.boundingBox(), footer = await actions.boundingBox();
  await design.click();
  await expect(form.getByRole('button', { name: 'Designing voices…', exact: true })).toBeVisible();
  const during = await list.boundingBox();
  finishDesign();
  await expect(form.getByRole('button', { name: 'Use voice 2', exact: true })).toBeVisible();
  const after = await list.boundingBox();
  for (const box of [during, after]) expect(box).toEqual(before);
  expect(await actions.boundingBox()).toEqual(footer);
  // The actions sit at the bottom of the workspace.
  const region = await form.boundingBox();
  expect(Math.abs(footer!.y + footer!.height - (region!.y + region!.height))).toBeLessThan(1.5);
  expect(region!.x).toBeGreaterThanOrEqual(0); expect(region!.x + region!.width).toBeLessThanOrEqual(width + .5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await form.getByRole('button', { name: 'Use voice 2', exact: true }).click();
  await expect(form.getByRole('group', { name: 'Character voice', exact: true })).toContainText('ElevenLabs voice: Grom');
  expect(saved).toEqual([{ name: 'Grom', description: 'A huge cave troll with a booming, gravelly voice and slow, deliberate pacing.', generatedVoiceId: 'generated_2abc' }]);
  await form.screenshot({ path: `test-results/character-workspace-${width}.png` });
  // Closing with unsaved changes asks; discarding leaves no character behind.
  await form.getByRole('button', { name: 'Close characters', exact: true }).click();
  await page.getByRole('dialog', { name: 'Discard unsaved changes?' }).getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect((await readProject(page)).characters ?? []).toEqual([]);
});
