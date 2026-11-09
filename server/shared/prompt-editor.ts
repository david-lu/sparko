import { AI_MODELS } from '../../shared/constants.js';
import type { AIClients } from './ai-clients.js';
import { HttpError } from './http.js';
import { targetedPromptEditInstructions } from './prompt-editing.js';

type PromptContent = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'low' };

/** One AI rewrite. The returned prompt content is neither parsed nor rewritten by the app. */
export async function rewritePromptText(openai: NonNullable<AIClients['openai']>, input: {
  instructions: string; data: Record<string, unknown>; maxLength: number; signal: AbortSignal;
  content?: PromptContent[]; paired?: boolean;
}) {
  input.signal.throwIfAborted();
  const textSchema = { type: 'string', minLength: 1, maxLength: input.maxLength };
  try {
    const response = await openai.responses.create({
      model: AI_MODELS.promptEnhancement, store: false, max_output_tokens: input.paired ? 8000 : 4000, reasoning: { effort: 'low' },
      instructions: `${input.instructions}\nReturn the complete prompt text in the requested JSON object. Each prompt may contain up to ${input.maxLength} characters. Keep it concise and complete.`,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: JSON.stringify(input.data) }, ...input.content ?? [],
      ] }],
      text: { format: { type: 'json_schema', name: 'rewritten_prompt', strict: true,
        schema: { type: 'object', properties: { prompt: textSchema, ...(input.paired ? { enhancedPrompt: textSchema } : {}) },
          required: input.paired ? ['prompt', 'enhancedPrompt'] : ['prompt'], additionalProperties: false } } },
    }, { signal: input.signal });
    input.signal.throwIfAborted();
    if (response.status !== 'completed' || !response.output_text) throw new HttpError(502, 'The AI response did not finish. Your prompts have been kept. Try again.');
    let result: { prompt?: unknown; enhancedPrompt?: unknown } | null;
    try { result = JSON.parse(response.output_text); }
    catch { throw new HttpError(502, 'The AI response could not be read. Your prompts have been kept. Try again.'); }
    // Check only the response envelope, so a missing response cannot erase a draft.
    // Shot structure, speech, timing, and other content are entirely the AI's job.
    const hasText = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
    if (!hasText(result?.prompt) || input.paired && !hasText(result?.enhancedPrompt)) throw new HttpError(502, 'The AI response is missing prompt text. Your prompts have been kept. Try again.');
    return { prompt: result.prompt, ...(input.paired ? { enhancedPrompt: result.enhancedPrompt as string } : {}), model: AI_MODELS.promptEnhancement };
  } catch (error) {
    if (input.signal.aborted) throw new HttpError(504, 'Prompt rewriting was cancelled or timed out.');
    if (error instanceof HttpError || (error as { status?: number })?.status) throw error;
    throw new HttpError(502, 'Unable to reach OpenAI. Check the connection and try again.');
  }
}

export function editPromptText(openai: NonNullable<AIClients['openai']>, input: {
  draft: string; enhancedPrompt?: string; editInstructions: string; maxLength: number; signal: AbortSignal;
  context?: Record<string, unknown>; content?: PromptContent[]; contextInstructions?: string;
}) {
  const paired = !!input.enhancedPrompt?.trim();
  return rewritePromptText(openai, { maxLength: input.maxLength, signal: input.signal, content: input.content, paired,
    instructions: targetedPromptEditInstructions + (paired
      ? '\nThe draft is the original prompt; enhancedPrompt is its downstream version. Apply the requested edit to BOTH, keeping them consistent. Return the complete edited original in prompt and the complete edited downstream version in enhancedPrompt. Preserve each version’s level of detail and unrelated content; do not copy one over the other. Reconcile outdated details in the enhanced version with the original and requested edit.' : '')
      + (input.contextInstructions ? `\n${input.contextInstructions}` : ''),
    data: { draft: input.draft, ...(paired ? { enhancedPrompt: input.enhancedPrompt } : {}), editInstructions: input.editInstructions, context: input.context },
  });
}
