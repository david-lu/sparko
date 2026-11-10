import { z } from 'zod';

/** Project cast: who speaks in generated dialogue and how each character sounds. */
export const CHARACTER_NAME_MAX_LENGTH = 60;
export const CHARACTER_VOICE_DESCRIPTION_MAX_LENGTH = 1000;
export const MAX_PROJECT_CHARACTERS = 24;

// Dialogue scripts use "Name: line", so names cannot contain a colon, brackets or line breaks.
export const characterNameSchema = z.string().trim().min(1, 'Enter a character name.').max(CHARACTER_NAME_MAX_LENGTH)
  .regex(/^[^:[\]\n\r]+$/, 'Character names cannot contain colons, square brackets or line breaks.');
export const elevenLabsVoiceIdSchema = z.string().regex(/^[A-Za-z0-9]{8,64}$/, 'Invalid ElevenLabs voice ID.');
export const characterVoiceSchema = z.object({ id: elevenLabsVoiceIdSchema, name: z.string().trim().min(1).max(200) });
export const characterSchema = z.object({
  id: z.uuid(),
  name: characterNameSchema,
  /** How the character sounds, in the user's words. Guides audio prompts and voice design. */
  voiceDescription: z.string().trim().max(CHARACTER_VOICE_DESCRIPTION_MAX_LENGTH).optional(),
  voice: characterVoiceSchema.optional(),
});
export type ProjectCharacter = z.infer<typeof characterSchema>;
export type CharacterVoice = z.infer<typeof characterVoiceSchema>;

export const characterKey = (name: string) => name.trim().toLocaleLowerCase();
export const projectCharactersSchema = z.array(characterSchema).max(MAX_PROJECT_CHARACTERS)
  .refine(items => new Set(items.map(c => c.id)).size === items.length, 'Duplicate characters.')
  .refine(items => new Set(items.map(c => characterKey(c.name))).size === items.length, 'Character names must be unique.');

/** What prompt enhancement learns about the cast; voice IDs stay out of AI requests. */
export const characterContextSchema = z.array(z.object({
  name: characterNameSchema,
  voiceDescription: z.string().trim().max(CHARACTER_VOICE_DESCRIPTION_MAX_LENGTH).optional(),
  voiceName: z.string().trim().max(200).optional(),
})).max(MAX_PROJECT_CHARACTERS);
export type CharacterContext = z.infer<typeof characterContextSchema>;
export const characterContext = (characters: readonly ProjectCharacter[] | undefined): CharacterContext | undefined => characters?.length
  ? characters.map(({ name, voiceDescription, voice }) => ({ name, ...(voiceDescription?.trim() ? { voiceDescription: voiceDescription.trim() } : {}), ...(voice ? { voiceName: voice.name } : {}) }))
  : undefined;
export const findCharacter = (characters: readonly ProjectCharacter[] | undefined, name: string) => characters?.find(c => characterKey(c.name) === characterKey(name));
