import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { newAssetGeneration, validateAssetSettings } from '../../shared/asset-generation';
import { createFalClient, falFiles, falPayload, falRequestPath } from '../../server/features/asset-generation/fal';
import { addAssetGenerationRoutes } from '../../server/features/asset-generation/routes';
import { errorHandler, protectRequests } from '../../server/shared/http';

describe('fal media generations', () => {
  it('maps the additional image models to their generation and editing endpoints', () => {
    const settings = newAssetGeneration('image').settings; settings.prompt = 'A poster'; settings.model = 'nano-banana-pro'; settings.count = 3;
    expect(falPayload(settings, [])).toMatchObject({ endpoint: 'fal-ai/nano-banana-pro', input: { num_images: 3, resolution: '1K', output_format: 'png' } });
    settings.references = [{ assetId: crypto.randomUUID(), name: 'base.png', kind: 'image' }];
    const references = [{ kind: 'image' as const, data: 'data:image/png;base64,YQ==' }];
    expect(falPayload(settings, references)).toMatchObject({ endpoint: 'fal-ai/nano-banana-pro/edit', input: { image_urls: [references[0].data] } });
    settings.model = 'flux-2-max'; expect(() => falPayload(settings, references)).toThrow('one output'); settings.count = 1;
    expect(falPayload(settings, references)).toMatchObject({ endpoint: 'fal-ai/flux-2-max/edit', input: { image_urls: [references[0].data], image_size: { width: 1024, height: 576 } } });
    expect(falPayload(settings, references).input).not.toHaveProperty('num_images');
    settings.references = []; expect(falPayload(settings, []).endpoint).toBe('fal-ai/flux-2-max');
    settings.model = 'ideogram-v3'; settings.count = 4;
    expect(falPayload(settings, [])).toMatchObject({ endpoint: 'fal-ai/ideogram/v3', input: { image_size: 'landscape_16_9', num_images: 4, enable_prompt_expansion: false } });
    settings.resolution = '4K'; expect(() => falPayload(settings, [])).toThrow('resolution');
    expect(falRequestPath('ideogram-v3', 'request_123')).toBe('fal-ai/ideogram/requests/request_123');
  });
  it('uses each model’s actual image, video, and audio API fields', () => {
    const settings = newAssetGeneration('image').settings; settings.prompt = 'A sunset';
    settings.references = [{ assetId: crypto.randomUUID(), name: 'ref', kind: 'image' }];
    const images = [{ kind: 'image' as const, data: 'data:image/png;base64,YQ==' }];
    expect(falPayload(settings, images)).toMatchObject({ endpoint: 'fal-ai/nano-banana-2/edit', input: { image_urls: [images[0].data], resolution: '1K', num_images: 1 } });
    settings.model = 'flux-2-pro';
    const flux = falPayload(settings, images); expect(flux.input).not.toHaveProperty('num_images'); expect(flux.input).toHaveProperty('image_size');
    settings.model = 'kling-video';
    expect(falPayload(settings, images)).toMatchObject({ endpoint: 'fal-ai/kling-video/v2.6/pro/image-to-video', input: { start_image_url: images[0].data, duration: '5' } });
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
    expect(fetcher).not.toHaveBeenCalled();
    await request(app).post('/api/library-generations').set('x-sparko-request', '1').send({ settings, inputs: [] }).expect(200, { requestId: 'request_123' });
    await request(app).get('/api/library-generations/nano-banana-2/request_123').expect(200, { phase: 'ready', count: 1 });
    await request(app).get('/api/library-generations/nano-banana-2/request_123/content/0').expect(200).expect('Content-Type', /image\/png/);
  });
});
