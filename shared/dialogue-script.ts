import { selectedCharacters, type ProjectCharacter } from './characters.js';

/**
 * A dialogue clip has one speaker for now: the selected character. The prompt is
 * the words they say, with optional audio tags such as [whispers].
 */
export type DialogueVoice = { speaker: string; voiceId: string; voiceName: string };
/** ElevenLabs recommends keeping the combined text of one dialogue request at or below 2,000 characters. */
export const DIALOGUE_MAX_TEXT_LENGTH = 2000;
export const DIALOGUE_MAX_SPEAKERS = 1;

/** The spoken text, dropping "Name:" labels for the speaker that would otherwise be read aloud. */
export function dialogueText(prompt: string, speaker?: string) {
  const lines = prompt.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const label = speaker ? new RegExp(`^${speaker.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i') : undefined;
  return lines.map(line => label ? line.replace(label, '') : line).join('\n').trim();
}
export function dialogueTextError(prompt: string, speaker?: string) {
  const text = dialogueText(prompt, speaker);
  if (!text) return 'Write what the speaker says.';
  if (text.length > DIALOGUE_MAX_TEXT_LENGTH) return `Keep the spoken text to ${DIALOGUE_MAX_TEXT_LENGTH.toLocaleString('en-US')} characters or fewer. Split longer speeches into separate clips.`;
}

/** Resolve the speaker's voice when a generation is submitted, so each version keeps the voice it used. */
export function castDialogueVoices(characterIds: readonly string[] | undefined, characters: readonly ProjectCharacter[] | undefined): { voices?: DialogueVoice[]; error?: string } {
  const speakers = selectedCharacters(characters, characterIds);
  if (!speakers.length) return { error: characters?.length ? 'Choose the character who speaks.' : 'Add a character with a voice in Characters, then choose them as the speaker.' };
  if (speakers.length > DIALOGUE_MAX_SPEAKERS) return { error: 'Dialogue clips have one speaker. Choose one character.' };
  const [speaker] = speakers;
  if (!speaker.voice) return { error: `${speaker.name} has no voice yet. Choose or design a voice for ${speaker.name} in Characters.` };
  return { voices: [{ speaker: speaker.name, voiceId: speaker.voice.id, voiceName: speaker.voice.name }] };
}
/** The request inputs for the submitted speaker. */
export function dialogueInputs(prompt: string, voices: readonly DialogueVoice[] | undefined): { inputs?: { text: string; voice_id: string }[]; error?: string } {
  const voice = voices?.[0];
  if (!voice || voices!.length > DIALOGUE_MAX_SPEAKERS) return { error: 'Choose the character who speaks.' };
  const error = dialogueTextError(prompt, voice.speaker); if (error) return { error };
  return { inputs: [{ text: dialogueText(prompt, voice.speaker), voice_id: voice.voiceId }] };
}
