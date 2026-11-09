import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIClients } from '../server/shared/ai-clients';
import { editPromptText } from '../server/shared/prompt-editor';

const respond = vi.fn();
const openai = { responses: { create: respond } } as unknown as NonNullable<AIClients['openai']>;
const input = { draft: 'A quiet room.', editInstructions: 'Add birdsong outside.', maxLength: 7000, signal: new AbortController().signal };
beforeEach(() => vi.resetAllMocks());

describe('general prompt editing', () => {
  it.each(['A quiet room with birdsong outside.', 'integrated_multimodal_description: [Shot 1] A quiet room. [Shot 2] Cut to the garden with birdsong.',
    'Scene:\n- A quiet room.\n- Birdsong outside.'])('returns the edited text without imposing extra structure: %s', async prompt => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt }) });
    expect((await editPromptText(openai, input)).prompt).toBe(prompt);
    expect(respond).toHaveBeenCalledOnce();
  });
  it.each([
    { status: 'incomplete', output_text: '{"prompt":"truncated' },
    { status: 'completed', output_text: 'not JSON' },
    { status: 'completed', output_text: '{"prompt":" "}' },
  ])('keeps invalid or incomplete provider output out of the draft: %j', async response => {
    respond.mockResolvedValue(response);
    await expect(editPromptText(openai, input)).rejects.toMatchObject({ status: 502, message: expect.stringContaining('Your prompts have been kept') });
  });
  it('discards a result returned after cancellation', async () => {
    const operation = new AbortController();
    respond.mockImplementation(async () => { operation.abort(); return { status: 'completed', output_text: '{"prompt":"Late edit"}' }; });
    await expect(editPromptText(openai, { ...input, signal: operation.signal })).rejects.toMatchObject({ status: 504 });
    expect(respond).toHaveBeenCalledOnce();
  });
  it('sanitizes connection failures without retrying them', async () => {
    respond.mockRejectedValue(new Error('private provider data'));
    await expect(editPromptText(openai, input)).rejects.toMatchObject({ status: 502, message: 'Unable to reach OpenAI. Check the connection and try again.' });
    expect(respond).toHaveBeenCalledOnce();
  });
});


describe('synchronized prompt editing', () => {
  const pair = { ...input, enhancedPrompt: 'Static shot of a quiet room. No music.' };
  it('sends both versions and returns both in one model call', async () => {
    const edited = { prompt: 'A quiet room with birdsong outside.', enhancedPrompt: 'Static shot of a quiet room. Birdsong outside; no music.' };
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify(edited) });
    expect(await editPromptText(openai, pair)).toMatchObject(edited);
    expect(respond).toHaveBeenCalledOnce();
    const options = respond.mock.calls[0][0];
    expect(JSON.parse(options.input[0].content[0].text)).toMatchObject({ draft: pair.draft, enhancedPrompt: pair.enhancedPrompt, editInstructions: pair.editInstructions });
    expect(options.text.format.schema.required).toEqual(['prompt', 'enhancedPrompt']);
    expect(options.instructions).toContain('Apply the requested edit to BOTH');
  });
  it.each([undefined, '', ' '])('rejects the entire edit if the downstream result is invalid: %s', async enhancedPrompt => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: 'Valid original edit', enhancedPrompt }) });
    await expect(editPromptText(openai, pair)).rejects.toMatchObject({ status: 502 });
  });
});
