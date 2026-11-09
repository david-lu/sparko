import { z } from 'zod';
import { AI_MODELS } from '../../shared/constants.js';
import type { AIClients } from './ai-clients.js';
import { HttpError } from './http.js';
import { targetedPromptEditInstructions } from './prompt-editing.js';

type EditContent = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'low' };

/** Edit text as supplied, without compiling it into a generation plan or adding defaults. */
export async function editPromptText(openai: NonNullable<AIClients['openai']>, input: {
  draft: string; enhancedPrompt?: string; editInstructions: string; maxLength: number; signal: AbortSignal;
  context?: Record<string, unknown>; content?: EditContent[];
}) {
  input.signal.throwIfAborted();
  const paired = !!input.enhancedPrompt?.trim();
  const textSchema = { type: 'string', minLength: 1, maxLength: input.maxLength };
  const promptSchema = z.string().trim().min(1).max(input.maxLength);
  try {
    const response = await openai.responses.create({
      model: AI_MODELS.promptEnhancement, store: false, max_output_tokens: paired ? 8000 : 4000, reasoning: { effort: 'low' },
      instructions: `${targetedPromptEditInstructions}\n${paired
        ? 'The draft is the original prompt; enhancedPrompt is its downstream enhanced version. Apply the requested edit to BOTH, keeping them consistent. Return the complete edited original in prompt and the complete edited enhanced version in enhancedPrompt. Preserve each version’s level of detail and unrelated content; do not replace one with a copy of the other. Reconcile outdated details in the enhanced version with the original and requested edit. Adjust affected timings and constraints within the text when needed. This is one synchronized edit, not a new enhancement or timing-planning pass.'
        : 'Return only the complete edited prompt in the requested JSON object.'}\nEach prompt may contain up to ${input.maxLength} characters. Do not return a separate plan, commentary, or a list of changes.`,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: JSON.stringify({ draft: input.draft, ...(paired ? { enhancedPrompt: input.enhancedPrompt } : {}), editInstructions: input.editInstructions, context: input.context }) },
        ...input.content ?? [],
      ] }],
      text: { format: { type: 'json_schema', name: 'edited_prompt', strict: true,
        schema: { type: 'object', properties: { prompt: textSchema, ...(paired ? { enhancedPrompt: textSchema } : {}) }, required: paired ? ['prompt', 'enhancedPrompt'] : ['prompt'], additionalProperties: false } } },
    }, { signal: input.signal });
    input.signal.throwIfAborted();
    if (response.status !== 'completed' || !response.output_text) throw new HttpError(502, 'Prompt editing did not finish. Your draft has been kept. Try again.');
    let parsed: unknown;
    try { parsed = JSON.parse(response.output_text); } catch { throw new HttpError(502, 'Prompt editing returned an unreadable response. Your draft has been kept. Try again.'); }
    const result = z.object({ prompt: promptSchema, enhancedPrompt: paired ? promptSchema : z.undefined().optional() }).safeParse(parsed);
    if (!result.success) throw new HttpError(502, 'Prompt editing returned an empty or overlong response. Your draft has been kept. Try again.');
    return { prompt: result.data.prompt, ...(paired ? { enhancedPrompt: result.data.enhancedPrompt } : {}), model: AI_MODELS.promptEnhancement };
  } catch (error) {
    if (input.signal.aborted) throw new HttpError(504, 'Prompt editing was cancelled or timed out.');
    if (error instanceof HttpError || (error as { status?: number })?.status) throw error;
    throw new HttpError(502, 'Unable to edit the prompt. Check the OpenAI connection and try again.');
  }
}
