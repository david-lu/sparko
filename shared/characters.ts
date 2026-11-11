import { z } from 'zod';

/** Project cast: who each character is, how they look and sound, and the references that show them. */
export const CHARACTER_NAME_MAX_LENGTH = 60;
export const CHARACTER_DESCRIPTION_MAX_LENGTH = 1000;
export const CHARACTER_MAX_IMAGES = 4;
export const MAX_PROJECT_CHARACTERS = 24;

// Names stay unambiguous in prompts, and a "Name:" label before dialogue can be dropped, so they cannot contain a colon, brackets or line breaks.
export const characterNameSchema = z.string().trim().min(1, 'Enter a character name.').max(CHARACTER_NAME_MAX_LENGTH)
  .regex(/^[^:[\]\n\r]+$/, 'Character names cannot contain colons, square brackets or line breaks.');
export const elevenLabsVoiceIdSchema = z.string().regex(/^[A-Za-z0-9]{8,64}$/, 'Invalid ElevenLabs voice ID.');
export const characterVoiceSchema = z.object({ id: elevenLabsVoiceIdSchema, name: z.string().trim().min(1).max(200) });
export const characterImageSchema = z.object({ assetId: z.uuid(), name: z.string().min(1).max(1000) });
// Descriptions are stored as typed, so editing in place never loses a trailing space.
const description = z.string().max(CHARACTER_DESCRIPTION_MAX_LENGTH);
export const characterSchema = z.object({
  id: z.uuid(),
  name: characterNameSchema,
  /** How the character sounds. Guides audio prompts, H3 voices and voice design. */
  voiceDescription: description.optional(),
  voice: characterVoiceSchema.optional(),
  /** How the character looks. Guides image and video prompts. */
  visualDescription: description.optional(),
  /** Library images that show the character, used as image and video references. */
  images: z.array(characterImageSchema).max(CHARACTER_MAX_IMAGES).refine(images => new Set(images.map(image => image.assetId)).size === images.length, 'Use each reference image once.').optional(),
});
export type ProjectCharacter = z.infer<typeof characterSchema>;
export type CharacterVoice = z.infer<typeof characterVoiceSchema>;
export type CharacterImage = z.infer<typeof characterImageSchema>;

export const characterKey = (name: string) => name.trim().toLocaleLowerCase();
export const projectCharactersSchema = z.array(characterSchema).max(MAX_PROJECT_CHARACTERS)
  .refine(items => new Set(items.map(c => c.id)).size === items.length, 'Duplicate characters.')
  .refine(items => new Set(items.map(c => characterKey(c.name))).size === items.length, 'Character names must be unique.');
/** Generations name the characters they feature. */
export const characterIdsSchema = z.array(z.uuid()).max(MAX_PROJECT_CHARACTERS);
export const characterImageAssetIds = (characters: readonly ProjectCharacter[] | undefined) => characters?.flatMap(c => c.images?.map(image => image.assetId) ?? []) ?? [];

/** What prompt enhancement learns about the cast. Voice IDs and asset IDs stay out of AI requests. */
export const characterContextSchema = z.array(z.object({
  name: characterNameSchema,
  voiceDescription: z.string().trim().max(CHARACTER_DESCRIPTION_MAX_LENGTH).optional(),
  voiceName: z.string().trim().max(200).optional(),
  visualDescription: z.string().trim().max(CHARACTER_DESCRIPTION_MAX_LENGTH).optional(),
  /** One-based numbers of the reference images that show this character, in the request's numbering. */
  images: z.array(z.number().int().min(1).max(16)).max(16).optional(),
})).max(MAX_PROJECT_CHARACTERS);
export type CharacterContext = z.infer<typeof characterContextSchema>;
type ContextFields = { voice?: boolean; visual?: boolean; images?: (character: ProjectCharacter) => number[] };
export function characterContext(characters: readonly ProjectCharacter[] | undefined, { voice = true, visual = false, images }: ContextFields = {}): CharacterContext | undefined {
  if (!characters?.length) return;
  return characters.map(character => {
    const voiceDescription = character.voiceDescription?.trim(), visualDescription = character.visualDescription?.trim(), numbers = images?.(character);
    return { name: character.name,
      ...(voice && voiceDescription ? { voiceDescription } : {}), ...(voice && character.voice ? { voiceName: character.voice.name } : {}),
      ...(visual && visualDescription ? { visualDescription } : {}), ...(numbers?.length ? { images: numbers } : {}) };
  });
}
export const findCharacter = (characters: readonly ProjectCharacter[] | undefined, name: string) => characters?.find(c => characterKey(c.name) === characterKey(name));
export const selectedCharacters = (characters: readonly ProjectCharacter[] | undefined, ids: readonly string[] | undefined) =>
  ids?.flatMap(id => characters?.find(c => c.id === id) ?? []) ?? [];
/** A unique default name such as "Character 2". */
export function nextCharacterName(characters: readonly ProjectCharacter[] | undefined) {
  for (let n = 1; ; n++) if (!findCharacter(characters, `Character ${n}`)) return `Character ${n}`;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether the text names the character as a whole word, ignoring case ("Mara" but not "Maraschino"). */
export const namesCharacter = (text: string, character: Pick<ProjectCharacter, 'name'>) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${escape(character.name.trim())}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text);
/** Selected characters first, then any others the text names, so enhancement can describe them. */
export function featuredCharacters(text: string, characters: readonly ProjectCharacter[] | undefined, selectedIds?: readonly string[]) {
  const selected = selectedCharacters(characters, selectedIds);
  return [...selected, ...characters?.filter(character => !selected.includes(character) && namesCharacter(text, character)) ?? []];
}
/** Characters a video features: those shown by its pictures or named in its prompt or dialogue. */
export function videoCharacterContext(item: { prompt: string; dialogue?: string; imageReferences?: readonly { characterId?: string }[] }, characters: readonly ProjectCharacter[] | undefined) {
  const pictures = item.imageReferences ?? [];
  const featured = featuredCharacters(`${item.prompt}\n${item.dialogue ?? ''}`, characters, [...new Set(pictures.flatMap(ref => ref.characterId ?? []))]);
  return characterContext(featured, { voice: true, visual: true, images: character => pictures.flatMap((ref, index) => ref.characterId === character.id ? [index + 1] : []) });
}
