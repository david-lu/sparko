import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../server/app';
import { errorHandler } from '../../server/shared/http';
import type { Providers } from '../../server/providers';

vi.mock('mediabunny', () => ({ ALL_FORMATS: [], BlobSource: class {}, Input: class {
  getPrimaryVideoTrack() { return Promise.resolve({ displayWidth: 1280, displayHeight: 720, computePacketStats: async () => ({ averagePacketRate: 24 }) }); }
  getPrimaryAudioTrack() { return Promise.resolve({}); }
  computeDuration() { return Promise.resolve(3.25); }
  dispose() {}
} }));
const comfy = { check: vi.fn(), submit: vi.fn(), status: vi.fn(), cancel: vi.fn(), assetUrl: vi.fn() };
const providers: Providers = { configured: { openai: false, gemini: false, fal: true, comfy: true }, models: { openai: 'test', gemini: 'test' },
  openai: vi.fn(), gemini: vi.fn(), voice: vi.fn(), falUpload: vi.fn(), falSubmit: vi.fn(), falCancel: vi.fn(), falStatus: vi.fn(), comfy };
let app: Express;
beforeAll(async () => { app = await createApp({ providers }); app.use(errorHandler); });
beforeEach(() => {
  vi.resetAllMocks(); providers.configured.comfy = true;
  comfy.submit.mockResolvedValue({ requestId: 'comfy-job-123', status: 'IN_QUEUE', insertion: { start: 39 / 24, duration: 148 / 24, totalDuration: 226 / 24 } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const submit = (before = '1.625', after = '1.625') => request(app).post('/api/comfy/interstitials').set('x-sparko-request', '1')
  .field('before', before).field('after', after).field('duration', '6').field('prompt', 'Bridge this scene').attach('video', Buffer.from('validated by the media-reader fixture'), { filename: 'reference.mp4', contentType: 'video/mp4' });

describe('Comfy API boundaries', () => {
  it('validates the reference and dispatches only to Comfy', async () => {
    await submit().expect(202);
    expect(comfy.submit).toHaveBeenCalledWith(expect.any(Blob), { before: 1.625, after: 1.625, duration: 6, prompt: 'Bridge this scene', width: 960, height: 544, hasAudio: true });
    expect(providers.falSubmit).not.toHaveBeenCalled();
  });
  it('rejects off-grid windows, missing context, and unavailable providers before submission', async () => {
    await submit('2', '2').expect(400);
    await submit('1', '1.625').expect(400);
    providers.configured.comfy = false; await submit().expect(503);
    expect(comfy.submit).not.toHaveBeenCalled();
  });
  it('requires same-origin mutation headers and workspace authentication', async () => {
    await request(app).post('/api/comfy/interstitials').expect(403);
    vi.stubEnv('APP_PASSWORD', 'workspace-secret');
    await request(app).get('/api/comfy/jobs/comfy-job-123').expect(401);
    await request(app).get('/api/comfy/assets/comfy-asset-123/content').expect(401);
    expect(comfy.status).not.toHaveBeenCalled(); expect(comfy.assetUrl).not.toHaveBeenCalled();
  });
  it('streams private output bytes with range support without forwarding application credentials', async () => {
    comfy.assetUrl.mockResolvedValue('https://storage.example/video.mp4?signed=fresh');
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'Content-Range': 'bytes 0-2/10', 'Content-Length': '3' } }));
    vi.stubGlobal('fetch', transport);
    const response = await request(app).get('/api/comfy/assets/comfy-asset-123/content').set('Range', 'bytes=0-2').expect(206);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-range']).toBe('bytes 0-2/10');
    expect(response.body).toEqual(Buffer.from([1, 2, 3]));
    expect(transport.mock.calls[0][1]?.headers).toEqual({ Range: 'bytes=0-2' });
  });
});
