import { describe, expect, it } from 'vitest';
import { characterReferences, newAssetGeneration, promptCharacters, validateAssetSettings, withCharacterReferences, type AssetSettings } from '../../shared/asset-generation';
import { characterContext, characterImageAssetIds, nextCharacterName, projectCharactersSchema, videoCharacterContext, type ProjectCharacter } from '../../shared/characters';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { assetUsage } from '../../src/features/project/assetUsage';
import { ProjectHistory } from '../../src/features/project/ProjectHistory';
import { assetIds, emptyAnalysis, type Asset, type Project } from '../../src/features/project/types';

const face = crypto.randomUUID(), coat = crypto.randomUUID(), base = crypto.randomUUID();
const mara: ProjectCharacter = { id: crypto.randomUUID(), name: 'Mara', voiceDescription: 'Low and husky. ', visualDescription: ' Red coat, short silver hair.', voice: { id: 'VoiceMara0001', name: 'Aria' },
  images: [{ assetId: face, name: 'mara-face.png' }, { assetId: coat, name: 'mara-coat.png' }] };
const theo: ProjectCharacter = { id: crypto.randomUUID(), name: 'Theo', visualDescription: 'Tall, freckled teenager.' };
const image = (patch: Partial<AssetSettings> = {}): AssetSettings => ({ ...newAssetGeneration('image').settings, prompt: 'Portrait', ...patch });

describe('project characters', () => {
  it('store descriptions as typed and limit reference images', () => {
    expect(projectCharactersSchema.parse([mara])[0]).toEqual(mara);
    expect(projectCharactersSchema.safeParse([{ ...mara, images: [...mara.images!, ...mara.images!.map(i => ({ ...i, assetId: crypto.randomUUID() })), { assetId: crypto.randomUUID(), name: 'x' }] }]).success).toBe(false);
    expect(projectCharactersSchema.safeParse([{ ...mara, images: [mara.images![0], mara.images![0]] }]).success).toBe(false);
    expect(characterImageAssetIds([mara, theo])).toEqual([face, coat]);
    expect(nextCharacterName([{ ...theo, name: 'Character 1' }])).toBe('Character 2');
  });
  it('sends trimmed descriptions without voice or asset IDs to prompt enhancement', () => {
    expect(characterContext([mara])).toEqual([{ name: 'Mara', voiceDescription: 'Low and husky.', voiceName: 'Aria' }]);
    expect(characterContext([mara], { voice: false, visual: true, images: () => [2] })).toEqual([{ name: 'Mara', visualDescription: 'Red coat, short silver hair.', images: [2] }]);
    expect(JSON.stringify(characterContext([mara], { visual: true }))).not.toMatch(/VoiceMara0001|mara-face/);
  });
  it('adds selected characters’ images after explicit references and numbers them for enhancement', () => {
    const settings = image({ references: [{ assetId: base, name: 'base.png', kind: 'image' }, { assetId: coat, name: 'coat again.png', kind: 'image' }], characterIds: [mara.id, theo.id] });
    expect(characterReferences(settings, [mara, theo])).toEqual([{ assetId: face, name: 'Mara 1', kind: 'image' }]);
    expect(withCharacterReferences(settings, [mara, theo]).references.map(ref => ref.assetId)).toEqual([base, coat, face]);
    expect(promptCharacters(settings, [mara, theo])).toEqual([
      { name: 'Mara', visualDescription: 'Red coat, short silver hair.', images: [2, 3] }, { name: 'Theo', visualDescription: 'Tall, freckled teenager.' }]);
    expect(withCharacterReferences(image(), [mara])).toEqual(image());
    // Ideogram takes no reference images; its prompt still learns how they look.
    const ideogram = image({ model: 'ideogram-v3', characterIds: [mara.id] });
    expect(characterReferences(ideogram, [mara])).toEqual([]);
    expect(validateAssetSettings(withCharacterReferences(ideogram, [mara]))).toBeUndefined();
    expect(promptCharacters(ideogram, [mara])).toEqual([{ name: 'Mara', visualDescription: 'Red coat, short silver hair.' }]);
    const crowded = image({ model: 'flux-2-max', references: Array.from({ length: 7 }, (_, i) => ({ assetId: crypto.randomUUID(), name: `${i}.png`, kind: 'image' as const })), characterIds: [mara.id] });
    expect(validateAssetSettings(withCharacterReferences(crowded, [mara]))).toContain('up to 8 images');
  });
  it('gives audio prompts the speaker or the characters they feature or name', () => {
    const audio = (model: string, prompt: string, characterIds?: string[]) => ({ ...newAssetGeneration('audio').settings, model, prompt, characterIds });
    expect(promptCharacters(audio('elevenlabs-dialogue', 'Hi Theo!', [mara.id]), [mara, theo])).toEqual([{ name: 'Mara', voiceDescription: 'Low and husky.', voiceName: 'Aria', visualDescription: 'Red coat, short silver hair.' }]);
    expect(promptCharacters(audio('elevenlabs-sound-effects', 'Mara laughs', [theo.id]), [mara, theo])?.map(c => c.name)).toEqual(['Theo', 'Mara']);
    expect(promptCharacters(audio('elevenlabs-music', 'Rain on a roof'), [mara, theo])).toBeUndefined();
  });
  it('describes characters an image prompt names even when they are not selected', () => {
    expect(promptCharacters(image({ prompt: 'theo eats a donut' }), [mara, theo])).toEqual([{ name: 'Theo', visualDescription: 'Tall, freckled teenager.' }]);
  });
  it('finds the characters a video features by picture or by name', () => {
    expect(videoCharacterContext({ prompt: 'Maraschino cherries on a table. Theo waves at <Picture 2>.', imageReferences: [{}, { characterId: mara.id }] }, [mara, theo])).toEqual([
      { name: 'Mara', voiceDescription: 'Low and husky.', voiceName: 'Aria', visualDescription: 'Red coat, short silver hair.', images: [2] },
      { name: 'Theo', visualDescription: 'Tall, freckled teenager.' }]);
    expect(videoCharacterContext({ prompt: 'An empty room.', dialogue: 'MARA: Hello?' }, [mara, theo])?.map(c => c.name)).toEqual(['Mara']);
    expect(videoCharacterContext({ prompt: 'An empty room.' }, [mara, theo])).toBeUndefined();
  });
});

describe('character references in the project document', () => {
  const project: Project = { id: 'p', name: 'Cast', updatedAt: 1, source: { name: 'Empty' }, subtitle: null, analysis: emptyAnalysis(), interstitials: [], characters: [mara],
    storyFlow: { version: 1, entryId: '', nodes: [], edges: [], templates: [] } };
  const media: Asset[] = [face, coat].map(id => ({ id, name: `${id}.png`, blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }) }));
  it('exports, imports and reports character images', async () => {
    expect(assetIds(project)).toEqual(expect.arrayContaining([face, coat]));
    expect(assetUsage(project, [coat])).toEqual([{ owner: 'Mara', role: 'Character reference image' }]);
    const signal = new AbortController().signal, progress = () => undefined;
    const result = await unpackProject(await packProject(project, media, signal, progress), signal, progress);
    const images = result.project.characters![0].images!;
    expect(images.map(i => i.name)).toEqual(['mara-face.png', 'mara-coat.png']);
    expect(images.every(i => !([face, coat] as string[]).includes(i.assetId) && result.assets.some(asset => asset.id === i.assetId))).toBe(true);
  });
  it('groups typing in one character into one undo step and labels list changes separately', () => {
    const history = new ProjectHistory(), typed = (text: string) => ({ ...project, characters: [{ ...mara, visualDescription: text }] });
    history.record(project, typed('R'), 0); history.record(typed('R'), typed('Red'), 100);
    expect(history.undoLabel).toBe('Edit character');
    expect(history.target('undo')?.characters).toEqual([mara]);
    history.endGroup(); history.record(typed('Red'), { ...typed('Red'), characters: [...typed('Red').characters!, theo] }, 200);
    expect(history.undoLabel).toBe('Edit characters');
  });
});
