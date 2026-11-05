import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ASSET_MODELS, newAssetGeneration } from '../../shared/asset-generation';
import { IMAGE_PROMPT_GUIDES } from '../../shared/image-prompt-guides';
import { createProviders } from '../../server/providers';
import { addImagePromptEnhancementRoutes } from '../../server/features/asset-generation/prompt-enhancement';
import { errorHandler, protectRequests } from '../../server/shared/http';

const respond = vi.hoisted(() => vi.fn());
vi.mock('openai', async original => ({ ...await original<typeof import('openai')>(), default: class { responses = { create: respond }; } }));
const prompt = 'A poster with the words "MIDNIGHT SUN" in amber lettering.';
const input = (model = 'nano-banana-pro') => ({ settings: { ...newAssetGeneration('image').settings, model, prompt, resolution: (model === 'seedream-4.5' ? '2K' : '1K') as '1K' | '2K' }, images: [] as string[], signal: new AbortController().signal });
beforeEach(() => { vi.resetAllMocks(); respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt }) }); });

describe('model-specific image prompt enhancement', () => {
  it('passes LoRA guidance as separate context and validates its length', async () => {
    const enhance = createProviders({ OPENAI_API_KEY: 'test' }).enhanceImagePrompt;
    await enhance({ ...input(), loraInstructions: 'Include the exact trigger Sema.' });
    const args = respond.mock.calls[0][0];
    expect(JSON.parse(args.input[0].content[0].text)).toMatchObject({ draft: prompt, loraInstructions: 'Include the exact trigger Sema.' });
    expect(args.instructions).toContain('Preserve exact trigger words');
    respond.mockClear();
    await expect(enhance({ ...input(), loraInstructions: 'x'.repeat(4001) })).rejects.toThrow();
    expect(respond).not.toHaveBeenCalled();
  });
  it.each(ASSET_MODELS.filter(m => m.kind === 'image'))('uses the official guide for $name', async model => {
    const result = await createProviders({ OPENAI_API_KEY: 'test' }).enhanceImagePrompt(input(model.id));
    expect(result).toEqual({ prompt, model: model.id, guideUrl: IMAGE_PROMPT_GUIDES[model.id].url });
    const args = respond.mock.calls[0][0];
    expect(args.instructions).toContain(IMAGE_PROMPT_GUIDES[model.id].rules);
    expect(args.instructions).toContain(model.name); expect(args.store).toBe(false);
    expect(args.instructions).not.toContain('integrated_multimodal_description');
    expect(args.input[0].content[0].text).toContain('MIDNIGHT SUN');
  });
  it('passes ordered image previews and cancels the actual provider request', async () => {
    const value = input(); value.settings.references = [1, 2].map(n => ({ assetId: crypto.randomUUID(), name: `Image ${n}`, kind: 'image' as const }));
    value.images = ['data:image/jpeg;base64,YQ==', 'data:image/jpeg;base64,Yg=='];
    await createProviders({ OPENAI_API_KEY: 'test' }).enhanceImagePrompt(value);
    const [args, options] = respond.mock.calls[0];
    expect(args.input[0].content.slice(1)).toEqual(value.images.flatMap((image_url, i) => [{ type: 'input_text', text: `Image ${i + 1}` }, { type: 'input_image', image_url, detail: 'low' }]));
    expect(options.signal).toBe(value.signal);
  });
  it.each([{ status: 'incomplete', output_text: '{}' }, { status: 'completed', output_text: 'not JSON' }, { status: 'completed', output_text: '{"prompt":""}' }])('rejects unusable provider output', async response => {
    respond.mockResolvedValue(response);
    await expect(createProviders({ OPENAI_API_KEY: 'test' }).enhanceImagePrompt(input())).rejects.toMatchObject({ status: 502 });
  });
  it('sanitizes provider errors', async () => {
    respond.mockRejectedValue(new Error('provider secret'));
    await expect(createProviders({ OPENAI_API_KEY: 'test' }).enhanceImagePrompt(input())).rejects.toMatchObject({ status: 502, message: 'Unable to enhance the image prompt. Check the OpenAI connection and try again.' });
  });
  it.each([
    { upstreamStatus: 401, status: 502, error: 'The provider rejected the API key or model access. Check your .env configuration.' },
    { upstreamStatus: 403, status: 502, error: 'The provider rejected the API key or model access. Check your .env configuration.' },
    { upstreamStatus: 429, status: 429, error: 'The provider quota or rate limit was reached. Check your account credits and try again.' },
  ])('returns actionable, sanitized errors for provider HTTP $upstreamStatus', async ({ upstreamStatus, status, error }) => {
    respond.mockRejectedValue(Object.assign(new Error('provider secret'), { status: upstreamStatus, headers: { authorization: 'secret-value' } }));
    const app = express();
    app.use(protectRequests, express.json()); addImagePromptEnhancementRoutes(app, createProviders({ OPENAI_API_KEY: 'test' })); app.use(errorHandler);
    const result = await request(app).post('/api/image-prompts/enhance').set('x-sparko-request', '1').send(input()).expect(status);
    expect(result.body).toEqual({ error });
    expect(result.text).not.toMatch(/provider secret|secret-value/);
  });
  it('protects the route and rejects unknown, non-image, incompatible and mismatched inputs before calling the provider', async () => {
    const providers = createProviders({ OPENAI_API_KEY: 'test' }), app = express();
    app.use(protectRequests, express.json({ limit: '1mb' })); addImagePromptEnhancementRoutes(app, providers); app.use(errorHandler);
    const body = input();
    await request(app).post('/api/image-prompts/enhance').send(body).expect(403);
    for (const model of ['unknown', 'kling-video']) await request(app).post('/api/image-prompts/enhance').set('x-sparko-request', '1').send({ ...body, settings: { ...body.settings, model } }).expect(400);
    await request(app).post('/api/image-prompts/enhance').set('x-sparko-request', '1').send({ ...body, images: ['data:image/jpeg;base64,YQ=='] }).expect(400);
    await request(app).post('/api/image-prompts/enhance').set('x-sparko-request', '1').send({ ...body, settings: { ...body.settings, references: [{ assetId: crypto.randomUUID(), name: 'audio', kind: 'audio' }] } }).expect(400);
    expect(respond).not.toHaveBeenCalled();
    await request(app).post('/api/image-prompts/enhance').set('x-sparko-request', '1').send(body).expect(200, { prompt, model: body.settings.model, guideUrl: IMAGE_PROMPT_GUIDES[body.settings.model].url });
  });
});
