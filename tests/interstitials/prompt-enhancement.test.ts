import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_MODELS } from '../../shared/constants';
import { createProviders } from '../../server/providers';
import { addPromptEnhancementRoutes, type EnhancePromptInput } from '../../server/features/interstitials/prompt-enhancement';
import { errorHandler, protectRequests } from '../../server/shared/http';
import { promptTimeline } from '../../shared/prompt-timing';
import { defaultMaskCurve } from '../../shared/mask-curves';

const respond = vi.hoisted(() => vi.fn());
vi.mock('openai', async original => ({ ...await original<typeof import('openai')>(), default: class { responses = { create: respond }; } }));
const input: EnhancePromptInput = { prompt: 'She asks, "What is 2 + 2?"', kind: 'call', duration: 6,
  referenceFrames: ['data:image/jpeg;base64,YQ=='], signal: new AbortController().signal };
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllEnvs());
const output = (prompt: string) => respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt }) });

// Regression: readable AI output must not be rejected by a second, code-based editor.
describe('AI-owned prompt enhancement', () => {
  it.each([
    { prefixFrames: 39, suffixFrames: 39, start: '1.625', end: '7.792', total: '9.417', body: '6.167', suffix: '1.625' },
    { prefixFrames: 39, suffixFrames: 0, start: '1.625', end: '8', total: '8', body: '6.375', suffix: '0' },
    { prefixFrames: 0, suffixFrames: 39, start: '0', end: '6.375', total: '8', body: '6.375', suffix: '1.625' },
    { prefixFrames: 0, suffixFrames: 0, start: '0', end: '6.583', total: '6.583', body: '6.583', suffix: '0' },
  ])('supplies both reference boundaries to Enhance and Edit: $prefixFrames / $suffixFrames', async ({ prefixFrames, suffixFrames, start, end, total, body, suffix }) => {
    for (const editInstructions of [undefined, 'Fix the timing and keep every spoken word.']) {
      respond.mockClear(); output('She speaks naturally within the generated section.');
      await createProviders({ OPENAI_API_KEY: 'test' }).enhancePrompt({ ...input, editInstructions,
        referenceTiming: { prefixFrames, suffixFrames }, keyframes: [{ frame: 11, image: 'data:image/jpeg;base64,YQ==' }] });
      expect(respond).toHaveBeenCalledOnce();
      const args = respond.mock.calls[0][0], instructions = args.instructions;
      expect(instructions).toContain(`from ${start} to ${end} seconds`);
      expect(instructions).toContain(`clock runs from 0 to ${body} seconds`);
      expect(instructions).toContain(`adding ${start} seconds exactly once`);
      expect(instructions).toContain(`end reference reserves ${suffix} seconds`);
      if (suffixFrames) expect(instructions).toContain(`occupy ${end} to ${total} seconds`);
      expect(instructions).toContain('already excludes BOTH reference windows');
      expect(instructions).toContain('never a conflict report, clarification question');
      expect(instructions).toContain('Keep the guide times and visible states fixed');
      expect(instructions).not.toContain('report the timing conflict instead');
      expect(JSON.parse(args.input[0].content[0].text).context.timeline).toEqual(promptTimeline(6, { prefixFrames, suffixFrames }));
    }
  });
  it('gives one rewrite the clocks, early guides and padded final hold from the reported conflict', async () => {
    const draft = 'S2 says "with a mega remote control" naturally while typing and finishes before the cut at 1.650 seconds. S1 holds a sock at generated time 13.167 and keeps it held to the end. Resolve the conflicting opening framing.';
    output('Corrected prompt with natural speech across the required cuts and the final sock held through the section end.');
    await createProviders({ OPENAI_API_KEY: 'test' }).enhancePrompt({ ...input, duration: 13, prompt: draft,
      referenceTiming: { prefixFrames: 39, suffixFrames: 0 },
      keyframes: [11, 33, 316].map(frame => ({ frame, image: 'data:image/jpeg;base64,YQ==' })) });
    expect(respond).toHaveBeenCalledOnce();
    const args = respond.mock.calls[0][0], instructions = args.instructions;
    expect(instructions).toContain('from 1.625 to 15.083 seconds');
    expect(instructions).toContain('clock runs from 0 to 13.458 seconds');
    expect(instructions).toContain('including padding after the last timed guide');
    expect(instructions).toContain('allow speech to continue across a necessary camera cut');
    expect(instructions).toContain('Images and a short time budget are not evidence that a line was already spoken');
    expect(instructions).toContain('do not ask which clock was intended');
    expect(JSON.parse(args.input[0].content[0].text).draft).toBe(draft);
    for (const time of ['0.458 seconds from the generated section\'s start; 2.083 seconds on the full-video clock',
      '1.375 seconds from the generated section\'s start; 3 seconds on the full-video clock',
      '13.167 seconds from the generated section\'s start; 14.792 seconds on the full-video clock']) {
      expect(args.input[0].content).toContainEqual(expect.objectContaining({ type: 'input_text', text: expect.stringContaining(time) }));
    }
  });
  it('includes encoded timing without footage and leaves shared briefs free of clip timing', async () => {
    output('A corrected prompt.');
    await createProviders({ OPENAI_API_KEY: 'test' }).enhancePrompt({ ...input, referenceFrames: [] });
    expect(respond.mock.calls[0][0].instructions).toContain('from 0 to 6.583 seconds');
    respond.mockClear();
    await createProviders({ OPENAI_API_KEY: 'test' }).enhancePrompt({ ...input, target: 'continuity' });
    expect(respond.mock.calls[0][0].instructions).not.toContain('generated-section clock');
    expect(JSON.parse(respond.mock.calls[0][0].input[0].content[0].text).context).not.toHaveProperty('timeline');
  });
  it.each([undefined, 'continuity'] as const)('keeps music continuous across shots for target %s, with explicit user overrides', async target => {
    output('Keep the music continuous through the cut.');
    await createProviders({ OPENAI_API_KEY: 'test' }).enhancePrompt({ ...input, target });
    const instructions = respond.mock.calls[0][0].instructions;
    expect(instructions).toContain('Continue established or requested music seamlessly between shots and across clip boundaries by default');
    expect(instructions).toContain('unless the user explicitly requests a music change or silence');
    expect(instructions).toContain('If no music is established or requested, do not invent a soundtrack');
  });
  it.each([
    'She smiles, asks the question, then waits quietly.',
    'integrated_multimodal_description: Keep the voices clear. [Shot 1] The boy speaks. [Shot 2] Cut to the girl after he finishes.',
    'integrated_multimodal_description: [Shot 1] She waves. [Shot 2] Cut to the garden.',
    '[Shot 2] The scene opens on a quiet garden.',
    '**Scene:** A quiet garden.\n**Sound:** Wind in the trees.',
    'From 0 to 3 seconds: she speaks. Then she waits.',
  ])('returns the AI text unchanged in one call: %s', async prompt => {
    output(prompt);
    const result = await createProviders({ OPENAI_API_KEY: 'test' }).enhancePrompt(input);
    expect(result).toEqual({ prompt, model: AI_MODELS.promptEnhancement });
    expect(respond).toHaveBeenCalledOnce();
    const [options, request] = respond.mock.calls[0];
    expect(options.text.format.schema.required).toEqual(['prompt']);
    expect(options.text.format.schema.properties.prompt.maxLength).toBe(7000);
    expect(options.instructions).toContain('using two rules');
    expect(options.instructions).toContain('Preserve event-based cuts without inventing timestamps');
    expect(options.instructions).toContain('nothing is appended by the application');
    expect(request.signal).toBe(input.signal);
  });
  it('gives the AI the original draft and complete context without extracting a script or adding a timing pass', async () => {
    const draft = '```text\n[Shot 1] S2 says <d>[English] with a mega remote control</d>\n[Shot 2] After he finishes, cut to S1. She asks <d>[English] A rock?</d>\n```';
    const referenceTiming = { prefixFrames: 39, suffixFrames: 39 }, timeline = promptTimeline(6, referenceTiming);
    const referenceDescriptions = [{ side: 'start' as const, frames: 39, description: 'A boy at a computer; soft music continues.' }];
    const referenceAudioMask = defaultMaskCurve(1.625, 1.625, 500);
    const prompt = 'The boy speaks, then cut to the girl. Continue the music.';
    output(prompt);
    const result = await createProviders({ OPENAI_API_KEY: 'test' }).enhancePrompt({ ...input, prompt: draft, referenceTiming,
      referenceDescriptions, referenceAudioMask, continuity: 'Keep the laboratory.', dialogue: 'A rock?', loraInstructions: 'Use Sema.',
      currentFrame: 'data:image/jpeg;base64,Yg==', imageReferences: ['data:image/jpeg;base64,Yw=='], imageGuides: { start: 0 },
      keyframes: [{ frame: 48, image: 'data:image/jpeg;base64,ZA==' }] });
    expect(result.prompt).toBe(prompt); expect(respond).toHaveBeenCalledOnce();
    const args = respond.mock.calls[0][0], data = JSON.parse(args.input[0].content[0].text);
    expect(data).toMatchObject({ draft, context: { timeline, duration: timeline.generatedDuration, referenceTiming, referenceDescriptions,
      referenceAudioMask, continuity: 'Keep the laboratory.', dialogue: 'A rock?', loraInstructions: 'Use Sema.', imageGuides: { start: '<Picture 1>' } } });
    expect(data).not.toHaveProperty('requiredDialogue');
    expect(data.context.referenceContext[0]).toMatchObject({ start: 0, end: 1.625, description: referenceDescriptions[0].description });
    expect(args.input[0].content.filter((v: { type: string }) => v.type === 'input_image')).toHaveLength(4);
    expect(args.input[0].content).toContainEqual(expect.objectContaining({ type: 'input_text', text: expect.stringContaining('generated frame 48') }));
    expect(args.input[0].content).toContainEqual({ type: 'input_text', text: 'H3 image reference <Picture 1>' });
  });
  it.each(['idle', 'continuity'] as const)('leaves %s wording to the AI without stripping or appending content', async target => {
    const prompt = 'Keep the same characters and setting. Preserve their natural voices.';
    output(prompt);
    expect((await createProviders({ OPENAI_API_KEY: 'test' }).enhancePrompt({ ...input,
      kind: target === 'idle' ? 'idle' : 'call', target: target === 'continuity' ? 'continuity' : undefined })).prompt).toBe(prompt);
    expect(respond).toHaveBeenCalledOnce();
  });
  it('provides the same image as both endpoint guides for an image-only Idle loop', async () => {
    output('A quiet loop.');
    await createProviders({ OPENAI_API_KEY: 'test' }).enhancePrompt({ ...input, kind: 'idle', duration: 2, referenceFrames: [], imageReferences: ['data:image/jpeg;base64,Yw=='] });
    expect(JSON.parse(respond.mock.calls[0][0].input[0].content[0].text).context.imageGuides).toEqual({ start: '<Picture 1>', end: '<Picture 1>' });
  });
  it('asks the model to respect its text budget without rejecting or truncating returned content in code', async () => {
    const prompt = 'A'.repeat(7001); output(prompt);
    expect((await createProviders({ OPENAI_API_KEY: 'test' }).enhancePrompt(input)).prompt).toBe(prompt);
    expect(respond.mock.calls[0][0].instructions).toContain('7000 characters');
    expect(respond).toHaveBeenCalledOnce();
  });
  it.each([{ status: 'incomplete', output_text: '{"prompt":"unfinished' }, { status: 'completed', output_text: 'not JSON' },
    { status: 'completed', output_text: '{}' }, { status: 'completed', output_text: '{"prompt":" "}' }])('handles an unusable API response without content-repair retries', async response => {
    respond.mockResolvedValue(response);
    await expect(createProviders({ OPENAI_API_KEY: 'test' }).enhancePrompt(input)).rejects.toMatchObject({ status: 502 });
    expect(respond).toHaveBeenCalledOnce();
  });
  it('does not start an aborted request or apply a response after cancellation', async () => {
    const operation = new AbortController(); operation.abort();
    await expect(createProviders({ OPENAI_API_KEY: 'test' }).enhancePrompt({ ...input, signal: operation.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(respond).not.toHaveBeenCalled();
    const pending = new AbortController();
    respond.mockImplementation(async () => { pending.abort(); return { status: 'completed', output_text: '{"prompt":"Late response"}' }; });
    await expect(createProviders({ OPENAI_API_KEY: 'test' }).enhancePrompt({ ...input, signal: pending.signal })).rejects.toMatchObject({ status: 504 });
    expect(respond).toHaveBeenCalledOnce();
  });
  it('sanitizes provider failures and does not turn them into content retries', async () => {
    respond.mockRejectedValue(new Error('private connection details'));
    await expect(createProviders({ OPENAI_API_KEY: 'test' }).enhancePrompt(input)).rejects.toMatchObject({ status: 502, message: 'Unable to reach OpenAI. Check the connection and try again.' });
    expect(respond).toHaveBeenCalledOnce();
  });
});

describe('prompt enhancement API', () => {
  const enhancePrompt = vi.fn(), configured = { openai: true, gemini: false, comfy: false };
  const app = express(); app.use(protectRequests, express.json());
  addPromptEnhancementRoutes(app, { configured, enhancePrompt }); app.use(errorHandler);
  beforeEach(() => { configured.openai = true; enhancePrompt.mockResolvedValue({ prompt: 'A restrained gesture.', model: AI_MODELS.promptEnhancement }); });
  const send = (body: object) => request(app).post('/api/interstitials/enhance-prompt').set('x-sparko-request', '1').send(body);
  const body = { prompt: input.prompt, kind: input.kind, duration: input.duration, referenceFrames: input.referenceFrames };
  it('validates timed image anchors before calling the enhancement provider', async () => {
    const image = 'data:image/jpeg;base64,Yg==';
    await send({ ...body, referenceTiming: { prefixFrames: 39, suffixFrames: 0 }, keyframes: [{ frame: 48, image }] }).expect(200);
    for (const keyframes of [[{ frame: -1, image }], [{ frame: 360, image }], [{ frame: 48, image }, { frame: 48, image }], [{ frame: 48, image: 'https://example.com/image.jpg' }]]) {
      await send({ ...body, keyframes }).expect(400);
    }
    await send({ ...body, imageGuides: { start: 0 }, keyframes: [{ frame: 0, image }] }).expect(400);
    expect(enhancePrompt).toHaveBeenCalledOnce();
  });
  it('accepts analysis only for the matching current reference windows', async () => {
    const referenceTiming = { prefixFrames: 39, suffixFrames: 0 }, description = { side: 'start', frames: 39, description: '0–1.625s: a wave.' };
    await send({ ...body, referenceTiming, referenceDescriptions: [description] }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ referenceDescriptions: [description] }));
    enhancePrompt.mockClear();
    for (const referenceDescriptions of [[{ ...description, frames: 56 }], [{ ...description, side: 'end' }], [description, description], [{ ...description, description: 'x'.repeat(16001) }]]) {
      await send({ ...body, referenceTiming, referenceDescriptions }).expect(400);
    }
    await send({ ...body, referenceDescriptions: [description] }).expect(400);
    await send({ ...body, referenceTiming, referenceDescriptions: [description], target: 'continuity' }).expect(400);
    expect(enhancePrompt).not.toHaveBeenCalled();
  });
  it('validates encoded reference timing and the full render length before calling AI', async () => {
    await send({ ...body, referenceTiming: { prefixFrames: 39, suffixFrames: 56 } }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ referenceTiming: { prefixFrames: 39, suffixFrames: 56 } }));
    enhancePrompt.mockClear();
    for (const referenceTiming of [{ prefixFrames: 48, suffixFrames: 0 }, { prefixFrames: -1, suffixFrames: 39 }, { prefixFrames: 39 }, { prefixFrames: '39', suffixFrames: 0 }]) {
      await send({ ...body, referenceTiming }).expect(400);
    }
    await send({ ...body, duration: 13, referenceTiming: { prefixFrames: 39, suffixFrames: 39 } }).expect(400);
    expect(enhancePrompt).not.toHaveBeenCalled();
  });
  it('validates and forwards separate edit instructions', async () => {
    await send({ ...body, editInstructions: '  Add a final question.  ' }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ prompt: body.prompt, editInstructions: 'Add a final question.' }));
    enhancePrompt.mockClear();
    for (const editInstructions of ['', '   ', 'x'.repeat(2001), 123, {}]) await send({ ...body, editInstructions }).expect(400);
    expect(enhancePrompt).not.toHaveBeenCalled();
  });
  it('validates the captured frame before forwarding it to the provider', async () => {
    const currentFrame = 'data:image/jpeg;base64,Yw==';
    await send({ ...body, currentFrame }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ currentFrame }));
    enhancePrompt.mockClear();
    for (const currentFrame of ['https://example.com/frame.jpg', 'data:image/jpeg;base64,' + 'YQ=='.repeat(8000), 123]) {
      await send({ ...body, currentFrame }).expect(400);
    }
    expect(enhancePrompt).not.toHaveBeenCalled();
  });
  it('passes only validated prompt context and frames to the enhancer', async () => {
    const response = await send({ ...body, apiKey: 'ignored', sourceUrl: 'https://ignored.example' }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith({ ...body, signal: expect.any(AbortSignal) });
    expect(response.body.prompt).toBe('A restrained gesture.');
  });
  it('validates and forwards optional LoRA instructions', async () => {
    await send({ ...body, loraInstructions: '  Name Sema.  ' }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ loraInstructions: 'Name Sema.' }));
    enhancePrompt.mockClear();
    for (const loraInstructions of ['x'.repeat(4001), 123, {}]) await send({ ...body, loraInstructions }).expect(400);
    expect(enhancePrompt).not.toHaveBeenCalled();
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
  it('allows an older 8,000-character draft to be enhanced instead of truncating it', async () => {
    const tail = '<d>[English] Keep these final words.</d>';
    const prompt = 'A'.repeat(8000 - tail.length) + tail;
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


it('passes both versions through the video edit route without requiring shot, sound or timing sections', async () => {
  const edited = { prompt: 'She waves in warm evening light.', enhancedPrompt: '[Shot 1] Static camera; she waves. [Shot 2] Cut to the garden in warm evening light.' };
  respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify(edited) });
  const app = express();
  app.use(protectRequests, express.json()); addPromptEnhancementRoutes(app, createProviders({ OPENAI_API_KEY: 'test' })); app.use(errorHandler);
  const enhancedPrompt = '[Shot 1] Static camera; she waves. [Shot 2] Cut to the garden in daylight.';
  const result = await request(app).post('/api/interstitials/enhance-prompt').set('x-sparko-request', '1')
    .send({ ...input, prompt: 'She waves in daylight.', enhancedPrompt, editInstructions: 'Change daylight to warm evening light.' }).expect(200);
  expect(result.body).toEqual({ ...edited, model: AI_MODELS.promptEnhancement });
  expect(JSON.parse(respond.mock.calls[0][0].input[0].content[0].text)).toMatchObject({ draft: 'She waves in daylight.', enhancedPrompt });
  expect(respond).toHaveBeenCalledOnce();
});
