import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ASSET_MODELS, newAssetGeneration } from '../../shared/asset-generation';
import { IMAGE_PROMPT_GUIDES } from '../../shared/image-prompt-guides';
import { createProviders } from '../../server/providers';
import { addImagePromptEnhancementRoutes } from '../../server/features/asset-generation/prompt-enhancement';
import { errorHandler, protectRequests } from '../../server/shared/http';
import { lightingColorContinuity } from '../../server/shared/prompt-lighting';

const respond = vi.hoisted(() => vi.fn());
vi.mock('openai', async original => ({ ...await original<typeof import('openai')>(), default: class { responses = { create: respond }; } }));
const prompt = 'A poster with the words "MIDNIGHT SUN" in amber lettering.';
const input = (model = 'nano-banana-pro') => ({ settings: { ...newAssetGeneration('image').settings, model, prompt, resolution: (model === 'seedream-4.5' ? '2K' : '1K') as '1K' | '2K' }, images: [] as string[], signal: new AbortController().signal });
beforeEach(() => { vi.resetAllMocks(); respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt }) }); });

describe('model-specific image prompt enhancement', () => {
  it('applies a targeted text replacement using separate edit instructions', async () => {
    const editInstructions = 'Change the title to "MOONRISE". Keep everything else.', edited = 'A poster reading "MOONRISE" with the original composition.';
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: edited }) });
    const value = input(), result = await createProviders({ OPENAI_API_KEY: 'test' }).enhanceImagePrompt({ ...value, editInstructions });
    expect(result.prompt).toBe(edited);
    const options = respond.mock.calls[0][0];
    expect(JSON.parse(options.input[0].content[0].text)).toMatchObject({ draft: value.settings.prompt, editInstructions });
    expect(options.instructions).toContain('This is a targeted edit, not a general enhancement.');
    expect(respond).toHaveBeenCalledOnce();
  });
  it('allows lighting edits without restoring the enhancement lighting lock', async () => {
    const value = input(), draft = `${value.settings.prompt} ${lightingColorContinuity}`;
    const edited = 'A poster with the words "MIDNIGHT SUN" under warm sunset light.';
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: edited }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test' }).enhanceImagePrompt({ ...value, settings: { ...value.settings, prompt: draft },
      editInstructions: 'Change the lighting to a warm sunset and remove conflicting lighting restrictions.', currentFrame: 'data:image/jpeg;base64,Yw==' });
    expect(result.prompt).toBe(edited);
    expect(result.model).toBe(value.settings.model);
    const options = respond.mock.calls[0][0];
    expect(JSON.parse(options.input[0].content[0].text)).toMatchObject({ draft, context: { kind: 'image' } });
    expect(options.input[0].content).toContainEqual(expect.objectContaining({ type: 'input_image', image_url: 'data:image/jpeg;base64,Yw==' }));
    expect(respond).toHaveBeenCalledOnce();
  });
  it('sends the current frame to the LLM without making it a numbered generation reference', async () => {
    const currentFrame = 'data:image/jpeg;base64,Yw==', value = input();
    await createProviders({ OPENAI_API_KEY: 'test' }).enhanceImagePrompt({ ...value, currentFrame });
    const args = respond.mock.calls[0][0], content = args.input[0].content;
    expect(JSON.parse(content[0].text)).toMatchObject({ mode: 'text-to-image', references: [] });
    expect(content.slice(1)).toEqual([
      { type: 'input_text', text: 'Current player frame (scene context only):' },
      { type: 'input_image', image_url: currentFrame, detail: 'low' },
    ]);
    expect(args.instructions).toContain('not a numbered generation reference or a first/last-frame constraint');
  });
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
    expect(result).toEqual({ prompt: `${prompt} ${lightingColorContinuity}`, model: model.id, guideUrl: IMAGE_PROMPT_GUIDES[model.id].url });
    const args = respond.mock.calls[0][0];
    expect(args.instructions).toContain(IMAGE_PROMPT_GUIDES[model.id].rules);
    expect(args.instructions).toContain(model.name); expect(args.store).toBe(false);
    expect(args.instructions).toContain(lightingColorContinuity);
    expect(args.instructions).toContain('Use the current player frame as the lighting and color baseline');
    expect(args.instructions).not.toContain('integrated_multimodal_description');
    expect(args.input[0].content[0].text).toContain('MIDNIGHT SUN');
  });
  it('passes ordered image previews and cancels the actual provider request', async () => {
    const value = input(); value.settings.references = [1, 2].map(n => ({ assetId: crypto.randomUUID(), name: `Image ${n}`, kind: 'image' as const }));
    value.images = ['data:image/jpeg;base64,YQ==', 'data:image/jpeg;base64,Yg=='];
    await createProviders({ OPENAI_API_KEY: 'test' }).enhanceImagePrompt({ ...value, currentFrame: 'data:image/jpeg;base64,Yw==' });
    const [args, options] = respond.mock.calls[0];
    expect(args.input[0].content.slice(3)).toEqual(value.images.flatMap((image_url, i) => [{ type: 'input_text', text: `Image ${i + 1}` }, { type: 'input_image', image_url, detail: 'low' }]));
    expect(options.signal).toBe(value.signal);
  });
  it('keeps the lighting/color lock exactly once when enhancing again', async () => {
    const enhance = createProviders({ OPENAI_API_KEY: 'test' }).enhanceImagePrompt;
    const first = await enhance(input());
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: first.prompt }) });
    const value = input(), repeated = await enhance({ ...value, settings: { ...value.settings, prompt: first.prompt } });
    expect(repeated.prompt).toBe(first.prompt);
    expect(JSON.parse(respond.mock.calls[1][0].input[0].content[0].text).draft).toBe(prompt);
  });
  it('repairs a copied image prompt using current settings and explicit corrections', async () => {
    const draft = 'A wide 16:9 poster with two cups and the title "MIDNIGHT SUN". Correction: show one cup, using the selected square aspect ratio. Preserve the established colors.';
    const repaired = 'Square poster with one cup and the exact title "MIDNIGHT SUN" in the established colors.';
    const value = input();
    value.settings.prompt = '```text\n' + draft + '\n```';
    value.settings.aspectRatio = '1:1';
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: '```text\n' + repaired + '\n```' }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test' }).enhanceImagePrompt(value);
    const args = respond.mock.calls[0][0];
    expect(JSON.parse(args.input[0].content[0].text)).toMatchObject({ draft, aspectRatio: '1:1' });
    expect(args.instructions).toContain('Apply explicit corrections to earlier prose.');
    expect(result.prompt).toBe(`${repaired} ${lightingColorContinuity}`);
    expect(respond).toHaveBeenCalledOnce();
  });
  it('reserves room for the lighting/color lock within the image prompt limit', async () => {
    const enhance = createProviders({ OPENAI_API_KEY: 'test' }).enhanceImagePrompt;
    await enhance(input());
    const limit = respond.mock.calls[0][0].text.format.schema.properties.prompt.maxLength;
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: 'x'.repeat(limit) }) });
    const result = await enhance(input());
    expect(result.prompt).toHaveLength(8000); expect(result.prompt).toMatch(/Lighting and color MUST NOT CHANGE\./);
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: 'x'.repeat(limit + 1) }) });
    await expect(enhance(input())).rejects.toMatchObject({ status: 502 });
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
  it('protects the route and rejects unknown, non-image, empty and mismatched inputs before calling the provider', async () => {
    const providers = createProviders({ OPENAI_API_KEY: 'test' }), app = express();
    app.use(protectRequests, express.json({ limit: '1mb' })); addImagePromptEnhancementRoutes(app, providers); app.use(errorHandler);
    const body = input();
    for (const editInstructions of ['', '  ', 'x'.repeat(2001), 123, {}]) {
      await request(app).post('/api/image-prompts/enhance').set('x-sparko-request', '1').send({ ...body, editInstructions }).expect(400);
    }
    await request(app).post('/api/image-prompts/enhance').send(body).expect(403);
    for (const model of ['unknown', 'kling-video']) await request(app).post('/api/image-prompts/enhance').set('x-sparko-request', '1').send({ ...body, settings: { ...body.settings, model } }).expect(400);
    await request(app).post('/api/image-prompts/enhance').set('x-sparko-request', '1').send({ ...body, images: ['data:image/jpeg;base64,YQ=='] }).expect(400);
    for (const currentFrame of ['https://example.com/frame.jpg', 'data:image/jpeg;base64,' + 'YQ=='.repeat(8000), 123]) {
      await request(app).post('/api/image-prompts/enhance').set('x-sparko-request', '1').send({ ...body, currentFrame }).expect(400);
    }
    await request(app).post('/api/image-prompts/enhance').set('x-sparko-request', '1').send({ ...body, settings: { ...body.settings, prompt: ' ' } }).expect(400);
    expect(respond).not.toHaveBeenCalled();
    await request(app).post('/api/image-prompts/enhance').set('x-sparko-request', '1').send(body).expect(200, { prompt: `${prompt} ${lightingColorContinuity}`, model: body.settings.model, guideUrl: IMAGE_PROMPT_GUIDES[body.settings.model].url });
  });
  it('enhances a draft even when its generation settings need correction', async () => {
    const value = input();
    value.settings.lora = 'style.safetensors';
    value.settings.count = 2; value.settings.resolution = '2K';
    value.settings.references = [{ assetId: crypto.randomUUID(), name: 'Audio context', kind: 'audio' }];
    const result = await createProviders({ OPENAI_API_KEY: 'test' }).enhanceImagePrompt(value);
    expect(result.prompt).toBe(`${prompt} ${lightingColorContinuity}`);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0][0].instructions).toContain('never invent their contents');
  });
});


it('edits the original and enhanced image prompts together without a separate enhancement pass', async () => {
  const value = input(), enhancedPrompt = 'A detailed poster reading "MIDNIGHT SUN", centered in amber lettering.';
  const edited = { prompt: 'A poster reading "MOONRISE".', enhancedPrompt: 'A detailed poster reading "MOONRISE", centered in amber lettering.' };
  respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify(edited) });
  const result = await createProviders({ OPENAI_API_KEY: 'test' }).enhanceImagePrompt({ ...value,
    settings: { ...value.settings, enhancedPrompt }, editInstructions: 'Change the title to MOONRISE.' });
  expect(result).toMatchObject({ ...edited, model: value.settings.model });
  expect(JSON.parse(respond.mock.calls[0][0].input[0].content[0].text)).toMatchObject({ draft: value.settings.prompt, enhancedPrompt });
  expect(respond).toHaveBeenCalledOnce();
});
