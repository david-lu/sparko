import { characterKey, findCharacter, type ProjectCharacter } from './characters.js';

/**
 * Dialogue prompts are scripts with one speaker turn per line:
 *   Mara: [whispers] Did you hear that?
 *   Theo: It's just the wind… right?
 * Lines without a "Name:" prefix continue the previous turn.
 */
export type DialogueTurn = { speaker: string; text: string };
export type DialogueVoice = { speaker: string; voiceId: string; voiceName: string };
export const DIALOGUE_MAX_VOICES = 10;
/** ElevenLabs recommends keeping the combined text of one dialogue request at or below 2,000 characters. */
export const DIALOGUE_MAX_TEXT_LENGTH = 2000;

const turnPattern = /^([^:[\]\n]{1,60}?)\s*:\s*(.*)$/;
export function parseDialogueScript(script: string): { turns: DialogueTurn[]; error?: string } {
  const turns: DialogueTurn[] = [];
  for (const raw of script.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const match = turnPattern.exec(line);
    if (match) turns.push({ speaker: match[1].trim(), text: match[2].trim() });
    else if (turns.length) turns[turns.length - 1].text = `${turns[turns.length - 1].text} ${line}`.trim();
    else return { turns: [], error: 'Start each line with a speaker name, such as “Mara: Did you hear that?”' };
  }
  if (!turns.length) return { turns, error: 'Write at least one line, such as “Mara: Did you hear that?”' };
  const empty = turns.find(turn => !turn.text);
  if (empty) return { turns, error: `Add a line for ${empty.speaker} or remove the empty turn.` };
  return { turns };
}
export const dialogueSpeakers = (turns: readonly DialogueTurn[]) => [...new Map(turns.map(turn => [characterKey(turn.speaker), turn.speaker])).values()];
export const dialogueTextLength = (turns: readonly DialogueTurn[]) => turns.reduce((total, turn) => total + turn.text.length, 0);

/** Resolve each speaker to its character's voice when a generation is submitted. */
export function castDialogueVoices(script: string, characters: readonly ProjectCharacter[] | undefined): { voices?: DialogueVoice[]; error?: string } {
  const { turns, error } = parseDialogueScript(script); if (error) return { error };
  const voices: DialogueVoice[] = [];
  for (const speaker of dialogueSpeakers(turns)) {
    const character = findCharacter(characters, speaker);
    if (!character) return { error: `No character is named “${speaker}”. Add ${speaker} under Characters in Project settings, or use an existing name.` };
    if (!character.voice) return { error: `${character.name} has no voice yet. Choose or design a voice for ${character.name} under Characters.` };
    voices.push({ speaker: character.name, voiceId: character.voice.id, voiceName: character.voice.name });
  }
  return { voices };
}
/** The request inputs for a script whose speakers were resolved at submission. */
export function dialogueInputs(script: string, voices: readonly DialogueVoice[] | undefined): { inputs?: { text: string; voice_id: string }[]; error?: string } {
  const { turns, error } = parseDialogueScript(script); if (error) return { error };
  if (dialogueSpeakers(turns).length > DIALOGUE_MAX_VOICES) return { error: `Dialogue can use up to ${DIALOGUE_MAX_VOICES} different voices.` };
  if (dialogueTextLength(turns) > DIALOGUE_MAX_TEXT_LENGTH) return { error: `Keep the spoken text to ${DIALOGUE_MAX_TEXT_LENGTH.toLocaleString('en-US')} characters or fewer. Split longer scenes into separate clips.` };
  const inputs = [];
  for (const turn of turns) {
    const voice = voices?.find(v => characterKey(v.speaker) === characterKey(turn.speaker));
    if (!voice) return { error: `Choose a voice for ${turn.speaker}.` };
    inputs.push({ text: turn.text, voice_id: voice.voiceId });
  }
  return { inputs };
}
