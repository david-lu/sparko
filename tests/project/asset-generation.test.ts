import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ASSET_MODELS, newAssetGeneration, validateAssetSettings } from '../../shared/asset-generation';
import { ClipGenerationController } from '../../src/features/project/ClipGenerationController';
import type { ProjectController } from '../../src/features/project/ProjectController';
import { emptyAnalysis, type Project } from '../../src/features/project/types';
import { createFalClient, falFiles, falPayload, falRequestPath } from '../../server/features/asset-generation/fal';
import { addAssetGenerationRoutes } from '../../server/features/asset-generation/routes';
import { errorHandler, protectRequests } from '../../server/shared/http';

describe('fal media generations', () => {
  it('maps the additional image models to their generation and editing endpoints', () => {
    const settings = newAssetGeneration('image').settings; settings.prompt = 'A poster'; settings.model = 'nano-banana-pro';
    expect(falPayload(settings, [])).toMatchObject({ endpoint: 'fal-ai/nano-banana-pro', input: { num_images: 1, resolution: '1K', output_format: 'png' } });
    settings.references = [{ assetId: crypto.randomUUID(), name: 'base.png', kind: 'image' }];
    const references = [{ kind: 'image' as const, data: 'data:image/png;base64,YQ==' }];
    expect(falPayload(settings, references)).toMatchObject({ endpoint: 'fal-ai/nano-banana-pro/edit', input: { image_urls: [references[0].data] } });
    settings.model = 'flux-2-max';
    expect(falPayload(settings, references)).toMatchObject({ endpoint: 'fal-ai/flux-2-max/edit', input: { image_urls: [references[0].data], image_size: { width: 1024, height: 576 } } });
    expect(falPayload(settings, references).input).not.toHaveProperty('num_images');
    settings.references = []; expect(falPayload(settings, []).endpoint).toBe('fal-ai/flux-2-max');
    settings.model = 'ideogram-v3';
    expect(falPayload(settings, [])).toMatchObject({ endpoint: 'fal-ai/ideogram/v3', input: { image_size: 'landscape_16_9', num_images: 1, enable_prompt_expansion: false } });
    settings.resolution = '4K'; expect(() => falPayload(settings, [])).toThrow('resolution');
    expect(falRequestPath('ideogram-v3', 'request_123')).toBe('fal-ai/ideogram/requests/request_123');
  });
  it('requests one image from every image model and rejects batch submissions', () => {
    for (const model of ASSET_MODELS.filter(m => m.kind === 'image')) {
      const settings = { ...newAssetGeneration('image').settings, model: model.id, resolution: model.resolutions[0] as '1K' | '2K' | '4K', prompt: 'A poster' };
      const { input } = falPayload(settings, []);
      if (model.id.startsWith('flux-')) expect(input).not.toHaveProperty('num_images');
      else expect(input.num_images).toBe(1);
      if (model.id === 'seedream-4.5') expect(input.max_images).toBe(1);
      expect(() => falPayload({ ...settings, count: 4 }, [])).toThrow('one output');
    }
  });
  it('resets older draft batch counts while retaining submitted jobs and saved versions', () => {
    const generation = newAssetGeneration('image'); generation.settings.count = 3; generation.settings.prompt = 'A poster';
    generation.submitted = structuredClone(generation.settings);
    generation.versions = [{ assetId: crypto.randomUUID(), name: 'Previous result', createdAt: 1, settings: structuredClone(generation.settings) }];
    let project: Project = { id: 'test', name: 'Legacy batch', updatedAt: 0, source: { name: 'Empty' }, subtitle: null, analysis: emptyAnalysis(), interstitials: [], clipGenerations: [generation] };
    let listener: (() => void) | undefined;
    const projects = { getSnapshot: () => ({ project }), subscribe: (callback: () => void) => { listener = callback; return () => { listener = undefined; }; },
      editAssets: vi.fn((change: (p: Project) => Project) => { project = change(project); listener?.(); }) };
    const stop = new ClipGenerationController(projects as unknown as ProjectController).watch();
    expect(project.clipGenerations![0].settings.count).toBe(1);
    expect(project.clipGenerations![0].submitted).toEqual(generation.submitted);
    expect(project.clipGenerations![0].versions).toEqual(generation.versions);
    expect(projects.editAssets).toHaveBeenCalledTimes(1); expect(projects.editAssets).toHaveBeenCalledWith(expect.any(Function), false);
    stop();
  });
  it('uses each model’s image and audio fields and rejects new Kling generations', () => {
    const settings = newAssetGeneration('image').settings; settings.prompt = 'A sunset';
    settings.references = [{ assetId: crypto.randomUUID(), name: 'ref', kind: 'image' }];
    const images = [{ kind: 'image' as const, data: 'data:image/png;base64,YQ==' }];
    expect(falPayload(settings, images)).toMatchObject({ endpoint: 'fal-ai/nano-banana-2/edit', input: { image_urls: [images[0].data], resolution: '1K', num_images: 1 } });
    settings.model = 'flux-2-pro';
    const flux = falPayload(settings, images); expect(flux.input).not.toHaveProperty('num_images'); expect(flux.input).toHaveProperty('image_size');
    settings.model = 'kling-video';
    expect(() => falPayload(settings, images)).toThrow('Comfy H3');
    expect(ASSET_MODELS.some(model => model.kind === 'video')).toBe(false);
    expect(() => newAssetGeneration('video')).toThrow('Comfy H3');
    settings.model = 'sound-effects'; settings.references = [];
    expect(falPayload(settings, [])).toMatchObject({ input: { text: 'A sunset', duration_seconds: 5 } });
    settings.model = 'stable-audio-2.5';
    expect(falPayload(settings, []).input).toHaveProperty('seconds_total', 5);
    settings.references = [{ assetId: crypto.randomUUID(), name: 'sound', kind: 'audio' }];
    expect(falPayload(settings, [{ kind: 'audio', data: 'audio' }])).toMatchObject({ endpoint: 'fal-ai/stable-audio-25/audio-to-audio', input: { audio_url: 'audio', total_seconds: 5 } });
    settings.duration = 5.5; expect(validateAssetSettings(settings)).toContain('whole number');
  });
  it('polls the app queue path and normalizes string and object media outputs', () => {
    expect(falRequestPath('kling-video', 'request_123')).toBe('fal-ai/kling-video/requests/request_123');
    expect(falRequestPath('seedream-4.5', 'request_123')).toBe('fal-ai/bytedance/requests/request_123');
    expect(falFiles({ audio: 'https://fal.media/audio.wav' }, 'audio')).toEqual([{ url: 'https://fal.media/audio.wav' }]);
    expect(() => falFiles({ error: 'failed' }, 'image')).toThrow('no usable media');
  });
  it('sanitizes provider errors and restricts output fetches without forwarding credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private secret prompt', { status: 401 }));
    const fal = createFalClient('secret-test-key', fetcher);
    await expect(fal.status('nano-banana-2', 'request_123')).rejects.toThrow('fal rejected');
    for (const url of ['http://fal.media/a', 'https://fal.media.evil.test/a', 'https://127.0.0.1/a', 'https://user:pass@fal.media/a']) await expect(fal.content({ url })).rejects.toThrow('unsupported');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(new Response('image', { headers: { 'content-type': 'image/png' } }));
    await fal.content({ url: 'https://v3.fal.media/output.png' });
    expect(fetcher.mock.calls.at(-1)?.[1]).not.toHaveProperty('headers');
  });
  it('protects submission, validates reference kinds, and streams ready results', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (String(url).endsWith('/status')) return Response.json({ status: 'COMPLETED' });
      if (String(url).includes('/requests/')) return Response.json({ images: [{ url: 'https://fal.media/image.png' }] });
      if (String(url).startsWith('https://fal.media')) return new Response('image', { headers: { 'content-type': 'image/png' } });
      return Response.json({ request_id: 'request_123' });
    });
    const app = express(); app.use(protectRequests); addAssetGenerationRoutes(app, createFalClient('test', fetcher)); app.use(errorHandler);
    const settings = newAssetGeneration('image').settings; settings.prompt = 'Sunset';
    await request(app).post('/api/library-generations').send({ settings, inputs: [] }).expect(403);
    await request(app).post('/api/library-generations').set('x-sparko-request', '1').send({ settings, inputs: [{ kind: 'video', data: 'data:image/png;base64,YQ==' }] }).expect(400);
    await request(app).post('/api/library-generations').set('x-sparko-request', '1').send({ settings: { ...settings, count: 3 }, inputs: [] }).expect(400);
    await request(app).post('/api/library-generations').set('x-sparko-request', '1').send({ settings: { ...settings, model: 'kling-video' }, inputs: [] }).expect(400);
    expect(fetcher).not.toHaveBeenCalled();
    await request(app).post('/api/library-generations').set('x-sparko-request', '1').send({ settings, inputs: [] }).expect(200, { requestId: 'request_123' });
    await request(app).get('/api/library-generations/nano-banana-2/request_123').expect(200, { phase: 'ready', count: 1 });
    await request(app).get('/api/library-generations/nano-banana-2/request_123/content/0').expect(200).expect('Content-Type', /image\/png/);
  });
});


it('submits only the selected prompt and refuses a stale enhanced image prompt', () => {
  const settings = { ...newAssetGeneration('image').settings, prompt: 'Original', enhancedPrompt: 'Enhanced', useEnhancedPrompt: true };
  expect(falPayload(settings, []).input.prompt).toBe('Enhanced');
  expect(falPayload({ ...settings, useEnhancedPrompt: false }, []).input.prompt).toBe('Original');
  expect(() => falPayload({ ...settings, enhancedPromptStale: true }, [])).toThrow('needs updating');
  expect(() => falPayload({ ...settings, enhancedPrompt: '' }, [])).toThrow('choose Original');
});
