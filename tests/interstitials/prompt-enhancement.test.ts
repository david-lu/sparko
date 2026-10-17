import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_MODELS } from '../../shared/constants';
import { createProviders } from '../../server/providers';
import { addPromptEnhancementRoutes, continuity, type EnhancePromptInput } from '../../server/features/interstitials/prompt-enhancement';
import { errorHandler, protectRequests } from '../../server/shared/http';

const respond = vi.hoisted(() => vi.fn());
vi.mock('openai', async importOriginal => ({
  ...await importOriginal<typeof import('openai')>(),
  default: class { responses = { create: respond }; },
}));
const input: EnhancePromptInput = { prompt: 'She asks, "What is 2 + 2?"', kind: 'call', duration: 6,
  referenceFrames: ['data:image/jpeg;base64,YQ=='], signal: new AbortController().signal };
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe('interstitial prompt enhancement', () => {
  it('uses the current model, reference frames and original dialogue with mandatory shot and position continuity', async () => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: 'She gently asks, "What is 2 + 2?", then pauses expectantly.' }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt(input);
    expect(result).toMatchObject({ model: AI_MODELS.promptEnhancement });
    expect(result.prompt).toContain('"What is 2 + 2?"');
    expect(result.prompt.endsWith(continuity)).toBe(true);
    expect(result.prompt.length).toBeLessThanOrEqual(600 + 1 + continuity.length);
    expect(result.prompt).not.toContain('\n');
    const [options, requestOptions] = respond.mock.calls[0];
    expect(options).toMatchObject({ model: AI_MODELS.promptEnhancement, store: false, reasoning: { effort: 'low' } });
    expect(JSON.parse(options.input[0].content[0].text)).toEqual({ draft: input.prompt, kind: 'call' });
    expect(options.input[0].content[1]).toEqual({ type: 'input_image', image_url: input.referenceFrames[0], detail: 'low' });
    expect(options.instructions).toContain('Nothing may snap to a new position');
    expect(options.instructions).toContain('Write the entire prompt in English');
    expect(options.instructions).toContain('translate non-English draft instructions and dialogue into natural English');
    expect(result.prompt).toContain('English speech only');
    expect(options.instructions).toContain('returns to the starting pose');
    expect(options.instructions).toContain('one or two short sentences');
    expect(options.instructions).toContain('Do not mention durations');
    expect(requestOptions.signal).toBe(input.signal);
    expect(respond).toHaveBeenCalledOnce();
  });
  it('keeps repeated enhancements from accumulating the mandatory continuity block', async () => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: `Quiet breathing.\n\n${continuity}` }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, kind: 'idle', prompt: `Quiet breathing.\n\n${continuity}` });
    expect(JSON.parse(respond.mock.calls[0][0].input[0].content[0].text)).toMatchObject({ draft: 'Quiet breathing.', kind: 'idle' });
    expect(result.prompt.split(continuity)).toHaveLength(2);
  });
  it('enhances a shared continuity brief without treating it as a clip action or appending another brief', async () => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: continuity }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, target: 'continuity', prompt: continuity });
    const options = respond.mock.calls[0][0];
    expect(JSON.parse(options.input[0].content[0].text).draft).toBe(continuity);
    expect(options.instructions).toContain('shared continuity brief');
    expect(options.instructions).toContain('Do not add stage-specific actions');
    expect(options.input[0].content[1].image_url).toBe(input.referenceFrames[0]);
    expect(result.prompt).toBe(continuity);
  });
  it.each([
    { status: 'incomplete', output_text: '{"prompt":"unfinished"}' },
    { status: 'completed', output_text: '{' },
    { status: 'completed', output_text: '{"prompt":""}' },
    { status: 'completed', output_text: JSON.stringify({ prompt: 'x'.repeat(601) }) },
    { status: 'completed', output_text: JSON.stringify({ prompt: 'x'.repeat(4000) }) },
  ])('rejects incomplete or invalid provider output without returning a replacement prompt', async response => {
    respond.mockResolvedValue(response);
    await expect(createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt(input)).rejects.toMatchObject({ status: 502 });
  });
  it('does not expose connection error details or retry automatically', async () => {
    respond.mockRejectedValue(new Error('private-key https://private.example/request'));
    await expect(createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt(input)).rejects.toMatchObject({ status: 502, message: 'Prompt enhancement could not reach OpenAI. Try again.' });
    expect(respond).toHaveBeenCalledOnce();
  });
  it('honors cancellation before contacting the provider', async () => {
    const operation = new AbortController(); operation.abort();
    await expect(createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, signal: operation.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(respond).not.toHaveBeenCalled();
  });
});

describe('prompt enhancement API', () => {
  const enhancePrompt = vi.fn(), configured = { openai: true, gemini: false, fal: false };
  const app = express(); app.use(protectRequests, express.json());
  addPromptEnhancementRoutes(app, { configured, enhancePrompt }); app.use(errorHandler);
  beforeEach(() => { configured.openai = true; enhancePrompt.mockResolvedValue({ prompt: `A restrained gesture.\n\n${continuity}`, model: AI_MODELS.promptEnhancement }); });
  const send = (body: object) => request(app).post('/api/interstitials/enhance-prompt').set('x-sparko-request', '1').send(body);
  const body = { prompt: input.prompt, kind: input.kind, duration: input.duration, referenceFrames: input.referenceFrames };
  it('passes only validated prompt context and frames to the enhancer', async () => {
    const response = await send({ ...body, apiKey: 'ignored', sourceUrl: 'https://ignored.example' }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith({ ...body, signal: expect.any(AbortSignal) });
    expect(response.body.prompt).toContain('no cuts or position jumps');
  });
  it('accepts a short Idle loop and retains compatibility with legacy dialogue settings', async () => {
    await send({ ...body, kind: 'idle', duration: 2, continuity: 'Keep the room and character.', dialogue: '' }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ kind: 'idle', duration: 2, continuity: 'Keep the room and character.', dialogue: '' }));
    enhancePrompt.mockClear();
    await send({ ...body, kind: 'response', duration: 2 }).expect(400);
    expect(enhancePrompt).not.toHaveBeenCalled();
  });
  it('accepts speech merged into a prompt longer than the old separate-field limit', async () => {
    const prompt = `${'A scene. '.repeat(500)}\n\nSpoken dialogue, verbatim: What do you think?`;
    await send({ ...body, prompt }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ prompt }));
  });
  it('passes the continuity target through to the enhancer', async () => {
    await send({ ...body, target: 'continuity' }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ target: 'continuity' }));
  });
  it.each([
    { ...body, prompt: '' }, { ...body, prompt: 'x'.repeat(8001) }, { ...body, duration: 99 },
    { ...body, kind: 'unknown' }, { ...body, target: 'unknown' }, { ...body, referenceFrames: ['https://arbitrary.example/image.jpg'] },
    { ...body, referenceFrames: [...body.referenceFrames, ...body.referenceFrames, ...body.referenceFrames] },
  ])('rejects invalid input before making a paid request', async invalid => {
    await send(invalid).expect(400); expect(enhancePrompt).not.toHaveBeenCalled();
  });
  it('requires application headers, authentication and OpenAI configuration', async () => {
    await request(app).post('/api/interstitials/enhance-prompt').send(body).expect(403);
    await send(body).set('Origin', 'https://untrusted.example').expect(403);
    configured.openai = false; await send(body).expect(503);
    configured.openai = true; vi.stubEnv('APP_PASSWORD', 'workspace-secret'); await send(body).expect(401);
    expect(enhancePrompt).not.toHaveBeenCalled();
  });
});
