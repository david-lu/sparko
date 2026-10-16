import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, errorHandler } from '../server/app';
import type { Providers } from '../server/providers';
import type { Express } from 'express';

const providers: Providers = {
  configured: { openai: true, gemini: true, fal: true }, models: { openai: 'test-openai', gemini: 'test-gemini' },
  openai: vi.fn<Providers['openai']>(async input => ({ caption: 'A caption', description: 'A description', provider: 'openai', model: 'test-openai', start: input.start, end: input.end, basis: 'Sampled frames' })),
  gemini: vi.fn(), falUpload: vi.fn(async () => 'https://fal.media/test.mp4'),
  falSubmit: vi.fn(async () => 'test-job-1234'), falStatus: vi.fn<Providers['falStatus']>(async requestId => ({ requestId, status: 'COMPLETED', videoUrl: 'https://fal.media/result.mp4' })),
  falCancel: vi.fn(async () => undefined),
};
let app: Express;
beforeAll(async () => { app = await createApp({ providers }); app.use(errorHandler); });
const post = (url: string) => request(app).post(url).set('x-sparko-request', '1');
describe('server API boundaries', () => {
  it('reports configuration without exposing secrets', async () => {
    const result = await request(app).get('/api/status').expect(200);
    expect(result.body.providers).toEqual({ openai: true, gemini: true, fal: true });
    expect(result.body.defaultVideo.name).toBe('episode_mock.mp4');
    expect(result.text).not.toMatch(/sk-|FAL_KEY|OPENAI_API_KEY|GEMINI_KEY/);
  });
  it('serves partial video responses', async () => {
    const result = await request(app).get('/media/episode_mock.mp4').set('Range', 'bytes=0-63').expect(206);
    expect(result.headers['content-length']).toBe('64');
    expect(result.headers['accept-ranges']).toBe('bytes');
  });
  it('rejects cross-origin and unmarked mutations before provider calls', async () => {
    await request(app).post('/api/fal/jobs').expect(403);
    await post('/api/fal/jobs').set('Origin', 'https://untrusted.example').expect(403);
    expect(providers.falSubmit).not.toHaveBeenCalled();
  });
  it('rejects invalid ranges and frames outside the range', async () => {
    await post('/api/analyze/openai').field('start', '10').field('end', '5').expect(400);
    await post('/api/analyze/openai').field('start', '0').field('end', '121').expect(400);
    await post('/api/analyze/openai').field('start', '1').field('end', '2').field('frames', JSON.stringify([{ time: 3, dataUrl: 'data:image/jpeg;base64,YQ==' }])).expect(400);
    expect(providers.openai).not.toHaveBeenCalled();
  });
  it('passes validated captions to the OpenAI provider', async () => {
    const result = await post('/api/analyze/openai').field('start', '1').field('end', '2').field('frames', JSON.stringify([{ time: 1.5, dataUrl: 'data:image/jpeg;base64,YQ==' }])).expect(200);
    expect(result.body.caption).toBe('A caption');
    expect(providers.openai).toHaveBeenCalledWith(expect.objectContaining({ start: 1, end: 2, frames: [expect.objectContaining({ time: 1.5 })] }));
  });
  it('rejects missing or invalid Gemini uploads', async () => {
    await post('/api/analyze/gemini').field('start', '0').field('end', '1').expect(400);
    await post('/api/analyze/gemini').field('start', '0').field('end', '1').attach('media', Buffer.from('not a video'), { filename: 'bad.mp4', contentType: 'video/mp4' }).expect(400);
    expect(providers.gemini).not.toHaveBeenCalled();
  });
  it('validates fal times, uploads the actual source and uses required schema fields', async () => {
    await post('/api/fal/jobs').field('source', 'default').field('start', '10').field('resume', '5').field('duration', '5').expect(400);
    const result = await post('/api/fal/jobs').field('source', 'default').field('start', '1').field('resume', '2').field('duration', '5').field('prompt', 'A new scene').expect(202);
    expect(result.body.requestId).toBe('test-job-1234');
    expect(providers.falUpload).toHaveBeenCalledWith(expect.any(Blob));
    expect(providers.falSubmit).toHaveBeenCalledWith(expect.objectContaining({ video_url: 'https://fal.media/test.mp4', start_time: 1, resume_time: 2, duration: 5, prompt: 'A new scene', resolution: '768p' }));
  });
  it('retrieves and cancels queue jobs', async () => {
    await request(app).get('/api/fal/jobs/test-job-1234').expect(200);
    await request(app).delete('/api/fal/jobs/test-job-1234').set('x-sparko-request', '1').expect(200);
    expect(providers.falCancel).toHaveBeenCalledWith('test-job-1234');
  });
  it('returns missing-key and provider-rate-limit errors without leaking errors', async () => {
    const missing = await createApp({ providers: { ...providers, configured: { openai: false, gemini: false, fal: false } } }); missing.use(errorHandler);
    await request(missing).post('/api/analyze/openai').set('x-sparko-request', '1').expect(503);
    vi.mocked(providers.openai).mockRejectedValueOnce({ status: 429, headers: { authorization: 'secret-value' } });
    const result = await post('/api/analyze/openai').field('start', '0').field('end', '1').field('frames', JSON.stringify([{ time: 0.5, dataUrl: 'data:image/jpeg;base64,YQ==' }])).expect(429);
    expect(result.text).not.toContain('secret-value');
  });
});
