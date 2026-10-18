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
const comfy = { check: vi.fn(), submit: vi.fn(), status: vi.fn(), events: vi.fn(), cancel: vi.fn(), assetUrl: vi.fn() };
const providers: Providers = { configured: { openai: false, gemini: false, comfy: true }, models: { openai: 'test', gemini: 'test' },
  openai: vi.fn(), gemini: vi.fn(), voice: vi.fn(), enhancePrompt: vi.fn(), comfy };
let app: Express;
beforeAll(async () => { app = await createApp({ providers }); app.use(errorHandler); });
beforeEach(() => {
  vi.resetAllMocks(); providers.configured.comfy = true;
  comfy.submit.mockResolvedValue({ requestId: 'comfy-job-123', status: 'IN_QUEUE', insertion: { start: 39 / 24, duration: 148 / 24, totalDuration: 226 / 24 } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const submit = (before = '1.625', after = '1.625', prompt = 'Bridge this scene', fields: Record<string, string> = {}) => request(app).post('/api/comfy/interstitials').set('x-sparko-request', '1')
  .field('before', before).field('after', after).field('duration', '6').field('prompt', prompt).field(fields).attach('video', Buffer.from('validated by the media-reader fixture'), { filename: 'reference.mp4', contentType: 'video/mp4' });

describe('Comfy API boundaries', () => {
  it('validates the reference and dispatches to Comfy', async () => {
    await submit().expect(202);
    expect(comfy.submit).toHaveBeenCalledWith(expect.any(Blob), { mode: 'bridge', maskInjection: 'standard', before: 1.625, after: 1.625, duration: 6, prompt: 'Bridge this scene', width: 1280, height: 736, hasAudio: true });
  });
  it.each(['true', 'false'])('migrates the legacy interpolation switch: %s', async interpolateMiddle => {
    await submit('1.625', '1.625', 'Exact prompt', { interpolateMiddle }).expect(202);
    expect(comfy.submit.mock.calls[0][1]).toMatchObject({ maskInjection: interpolateMiddle === 'true' ? 'uniform' : 'standard', prompt: 'Exact prompt' });
  });
  it.each(['standard', 'uniform', 'vignette'])('passes the selected mask mode unchanged: %s', async maskInjection => {
    await submit('1.625', '1.625', 'Exact prompt', { maskInjection }).expect(202);
    expect(comfy.submit.mock.calls[0][1]).toMatchObject({ maskInjection, prompt: 'Exact prompt' });
  });
  it('rejects invalid interpolation settings and extensions without an end reference', async () => {
    await submit('1.625', '1.625', 'Exact', { interpolateMiddle: 'yes' }).expect(400);
    await submit('1.625', '0', 'Exact', { mode: 'extend', interpolateMiddle: 'true' }).expect(400);
    await submit('1.625', '1.625', 'Exact', { maskInjection: 'unknown' }).expect(400);
    await submit('1.625', '0', 'Exact', { mode: 'extend', maskInjection: 'vignette' }).expect(400);
    expect(comfy.submit).not.toHaveBeenCalled();
  });
  it('passes the entered prompt through to Comfy without rewriting it', async () => {
    await submit('1.625', '1.625', 'First direction.\r\n\r\nSecond direction.').expect(202);
    expect(comfy.submit.mock.calls[0][1].prompt).toBe('First direction.\r\n\r\nSecond direction.');
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
    await request(app).get('/api/comfy/jobs/comfy-job-123/events').expect(401);
    await request(app).get('/api/comfy/assets/comfy-asset-123/content').expect(401);
    expect(comfy.status).not.toHaveBeenCalled(); expect(comfy.assetUrl).not.toHaveBeenCalled();
    expect(comfy.events).not.toHaveBeenCalled();
  });
  it('delivers live events without caching and closes the cloud subscription when done', async () => {
    comfy.events.mockImplementation(async function* () {
      yield { type: 'progress', progress: .4, progressDetails: { stage: 'Generating video and audio', step: 8, steps: 20 } };
      yield { type: 'refresh' };
    });
    const response = await request(app).get('/api/comfy/jobs/comfy-job-123/events').expect(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-transform');
    expect(response.text).toContain('event: progress\n');
    expect(response.text).toContain('"step":8,"steps":20');
    expect(response.text).toContain('event: refresh\n');
    expect(comfy.events.mock.calls[0][1].aborted).toBe(true);
    expect(comfy.cancel).not.toHaveBeenCalled();
  });
  it('falls back to polling on an upstream stream failure without exposing provider details', async () => {
    comfy.events.mockImplementation(async function* () { throw new Error('private-key'); });
    const response = await request(app).get('/api/comfy/jobs/comfy-job-123/events').expect(200);
    expect(response.text).toBe('event: fallback\ndata: {}\n\n');
    expect(comfy.cancel).not.toHaveBeenCalled();
    await request(app).get('/api/comfy/jobs/invalid/events').expect(400);
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
  it('reports failed media connections as recoverable downloads instead of generic server errors', async () => {
    comfy.assetUrl.mockResolvedValue('https://storage.example/video.mp4?signed=private');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')));
    const response = await request(app).get('/api/comfy/assets/comfy-asset-123/content').expect(502);
    expect(response.body.error).toContain('downloading the generated video');
    expect(response.body.error).toContain('no new generation is needed');
    expect(response.text).not.toContain('signed=private');
    expect(comfy.submit).not.toHaveBeenCalled();
  });
});
