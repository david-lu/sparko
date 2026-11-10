import { z } from 'zod';

/** Project-wide guidance applied whenever AI enhances or edits a prompt in the project. */
export const PROMPT_INSTRUCTIONS_MAX_LENGTH = 4000;
export const promptInstructionsSchema = z.string().trim().max(PROMPT_INSTRUCTIONS_MAX_LENGTH);
/** The guidance sent with an enhancement request; blank instructions are omitted. */
export const projectPromptInstructions = (project: { promptInstructions?: string } | null | undefined) => project?.promptInstructions?.trim() || undefined;
