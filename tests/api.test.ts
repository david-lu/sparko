import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { errorHandler } from '../server/shared/http';
import type { Providers } from '../server/providers';
import type { Express } from 'express';
import { wavFixture } from './fixtures/audio';

const providers: Providers = {
  configured: { openai: true, gemini: true, fal: true }, models: { openai: 'test-openai', gemini: 'test-gemini' },
  openai: vi.fn<Providers['openai']>(async input => ({ caption: 'A caption', description: 'A description', provider: 'openai', model: 'test-openai', start: input.start, end: input.end, basis: 'Sampled frames' })),
  gemini: vi.fn(), falUpload: vi.fn(async () => 'https://fal.media/test.mp4'),
  voice: vi.fn<Providers['voice']>(async (provider, input) => ({ transcript: 'My spoken answer', response: 'Answer received.', provider, model: `test-${provider}`, context: input.context })),
  falSubmit: vi.fn(async () => 'test-job-1234'), falStatus: vi.fn<Providers['falStatus']>(async requestId => ({ requestId, status: 'COMPLETED', videoUrl: 'https://fal.media/result.mp4' })),
  falCancel: vi.fn(async () => undefined),
  enhancePrompt: vi.fn(),
};
let app: Express;
beforeAll(async () => { app = await createApp({ providers }); app.use(errorHandler); });
const post = (url: string) => request(app).post(url).set('x-sparko-request', '1');
describe('server API boundaries', () => {
  it('reports configuration without exposing secrets', async () => {
    const result = await request(app).get('/api/status').expect(200);
    expect(result.body.providers).toEqual({ openai: true, gemini: true, fal: true });
    expect(result.body.defaultVideo.name).toBe('sample.mp4');
    expect(result.body.defaultVideo.url).toBe('/media/sample.mp4');
    expect(result.text).not.toMatch(/sk-|FAL_KEY|OPENAI_API_KEY|GEMINI_KEY/);
  });
  it('serves partial video responses', async () => {
    const result = await request(app).get('/media/sample.mp4').set('Range', 'bytes=0-63').expect(206);
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
    expect(providers.falSubmit).toHaveBeenCalledWith(expect.objectContaining({ video_url: 'https://fal.media/test.mp4', start_time: 1, resume_time: 2, duration: 5, prompt: 'A new scene', resolution: '768p', enable_prompt_expansion: false }));
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
  it('accepts bounded voice audio with optional scene context for either provider', async () => {
    const context = { sourceId: 'episode', videoTime: 12.5, sceneId: 'scene-1', question: 'What happened?' };
    for (const provider of ['openai', 'gemini']) {
      const result = await post(`/api/voice/${provider}`).field('context', JSON.stringify(context))
        .attach('audio', wavFixture(), { filename: 'answer.wav', contentType: 'audio/wav' }).expect(200);
      expect(result.body.context).toEqual(context);
      expect(result.body.provider).toBe(provider);
      expect(providers.voice).toHaveBeenCalledWith(provider, expect.objectContaining({ context, mimeType: 'audio/wav', audio: wavFixture(), signal: expect.any(AbortSignal) }));
    }
  });
  it('rejects missing, malformed, oversized or overlong voice input before inference', async () => {
    vi.mocked(providers.voice).mockClear();
    const context = JSON.stringify({ sourceId: 'episode', videoTime: 5 });
    await post('/api/voice/openai').field('context', context).expect(400);
    await post('/api/voice/openai').field('context', '{bad').expect(400);
    await post('/api/voice/openai').field('context', JSON.stringify({ sourceId: 'episode', videoTime: -1 })).expect(400);
    await post('/api/voice/openai').field('context', context).attach('audio', Buffer.from('bad'), { filename: 'answer.wav', contentType: 'audio/wav' }).expect(400);
    await post('/api/voice/openai').field('context', context).attach('audio', wavFixture(61), { filename: 'answer.wav', contentType: 'audio/wav' }).expect(400);
    const oversized = await post('/api/voice/openai').field('context', context).attach('audio', Buffer.alloc(2 * 1024 * 1024 + 1), { filename: 'answer.wav', contentType: 'audio/wav' }).expect(400);
    expect(oversized.body.error).toContain('2 MB');
    expect(providers.voice).not.toHaveBeenCalled();
  });
  it('protects voice requests and handles provider errors without exposing credentials', async () => {
    await request(app).post('/api/voice/openai').expect(403);
    await post('/api/voice/openai').set('Origin', 'https://untrusted.example').expect(403);
    await post('/api/voice/unknown').expect(404);
    const missing = await createApp({ providers: { ...providers, configured: { openai: false, gemini: false, fal: false } } }); missing.use(errorHandler);
    await request(missing).post('/api/voice/openai').set('x-sparko-request', '1').expect(503);
    vi.mocked(providers.voice).mockRejectedValueOnce({ status: 429, message: 'secret-value' });
    const result = await post('/api/voice/openai').field('context', JSON.stringify({ sourceId: 'episode', videoTime: 1 }))
      .attach('audio', wavFixture(), { filename: 'answer.wav', contentType: 'audio/wav' }).expect(429);
    expect(result.text).not.toContain('secret-value');
  });
  it('defaults older interstitial requests to six seconds using local insertion times', async () => {
    vi.mocked(providers.falSubmit).mockClear();
    await post('/api/interstitials').field('start', '2').field('resume', String(49 / 24)).field('fps', '24').field('prompt', 'A new interstitial')
      .attach('video', 'tests/fixtures/interstitial-reference.mp4', { contentType: 'video/mp4' }).expect(202);
    expect(providers.falSubmit).toHaveBeenCalledWith({ video_url: 'https://fal.media/test.mp4', start_time: 2, resume_time: 49 / 24,
      duration: 6, resolution: '768p', prompt: 'A new interstitial', enable_prompt_expansion: false, color_match: true });
  });
  it.each([5, 7.5, 13])('submits the selected %s-second interstitial duration to fal', async duration => {
    vi.mocked(providers.falSubmit).mockClear();
    await post('/api/interstitials').field('start', '2').field('resume', String(49 / 24)).field('fps', '24').field('prompt', 'A new interstitial').field('duration', String(duration))
      .attach('video', 'tests/fixtures/interstitial-reference.mp4', { contentType: 'video/mp4' }).expect(202);
    expect(providers.falSubmit).toHaveBeenCalledWith(expect.objectContaining({ duration }));
  });
  it.each([true, false])('submits the selected prompt expansion setting: %s', async enabled => {
    vi.mocked(providers.falSubmit).mockClear();
    await post('/api/interstitials').field('start', '2').field('resume', String(49 / 24)).field('fps', '24').field('prompt', 'A new interstitial')
      .field('enable_prompt_expansion', String(enabled)).attach('video', 'tests/fixtures/interstitial-reference.mp4', { contentType: 'video/mp4' }).expect(202);
    expect(providers.falSubmit).toHaveBeenCalledWith(expect.objectContaining({ enable_prompt_expansion: enabled }));
  });
  it('rejects invalid prompt expansion flags before contacting fal', async () => {
    vi.mocked(providers.falUpload).mockClear(); vi.mocked(providers.falSubmit).mockClear();
    for (const value of ['yes', '0', '']) {
      await post('/api/interstitials').field('start', '2').field('resume', String(49 / 24)).field('fps', '24').field('prompt', 'A new interstitial')
        .field('enable_prompt_expansion', value).attach('video', 'tests/fixtures/interstitial-reference.mp4', { contentType: 'video/mp4' }).expect(400);
    }
    expect(providers.falUpload).not.toHaveBeenCalled(); expect(providers.falSubmit).not.toHaveBeenCalled();
  });
  it('rejects blank, nonnumeric and unsupported durations before uploading or submitting', async () => {
    vi.mocked(providers.falUpload).mockClear(); vi.mocked(providers.falSubmit).mockClear();
    for (const duration of ['', 'NaN', 'Infinity', '0', '4.99', '13.01']) {
      await post('/api/interstitials').field('start', '2').field('resume', String(49 / 24)).field('fps', '24').field('prompt', 'A new interstitial').field('duration', duration)
        .attach('video', 'tests/fixtures/interstitial-reference.mp4', { contentType: 'video/mp4' }).expect(400);
    }
    expect(providers.falUpload).not.toHaveBeenCalled(); expect(providers.falSubmit).not.toHaveBeenCalled();
  });
  it('rejects invalid interstitial reference bounds before provider submission', async () => {
    vi.mocked(providers.falSubmit).mockClear();
    await request(app).post('/api/interstitials').expect(403);
    await post('/api/interstitials').field('start', '2').field('resume', '2.08').field('fps', '25').field('prompt', 'A scene').expect(400);
    await post('/api/interstitials').field('start', '2').field('resume', '2.08').field('fps', '25').field('prompt', 'Old reference')
      .attach('video', 'tests/fixtures/interstitial-reference.mp4', { contentType: 'video/mp4' }).expect(400);
    for (const [start, resume, prompt] of [['1', '1.08', 'A scene'], ['2', '2', 'A scene'], ['2', '2.04', 'A scene'], ['2', '3', 'A scene'], ['4', '4.08', 'A scene'], ['2', '2.08', '']]) {
      await post('/api/interstitials').field('start', start).field('resume', resume).field('fps', '24').field('prompt', prompt)
        .attach('video', 'tests/fixtures/interstitial-reference.mp4', { contentType: 'video/mp4' }).expect(400);
    }
    expect(providers.falSubmit).not.toHaveBeenCalled();
  });
});
