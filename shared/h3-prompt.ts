import { H3_PROMPT_MAX_LENGTH } from './constants.js';

// Multipart form fields use CRLF; count and submit the same logical line breaks as the editor.
export const normalizeH3Prompt = (prompt: string) => prompt.replace(/\r\n?/g, '\n');
export const H3_PROMPT_LENGTH_ERROR = `H3 prompts must be ${H3_PROMPT_MAX_LENGTH.toLocaleString('en-US')} characters or fewer. Shorten the prompt or enhance it again.`;
export function validateH3PromptLength(prompt: string): void {
  if (normalizeH3Prompt(prompt).length > H3_PROMPT_MAX_LENGTH) throw new Error(H3_PROMPT_LENGTH_ERROR);
}
