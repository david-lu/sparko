import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Providers } from '../server/providers';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function passwordApp(vercel: string, password: string | undefined) {
  vi.stubEnv('VERCEL', vercel);
  vi.stubEnv('APP_PASSWORD', password);
  vi.stubEnv('DEFAULT_PROJECT_URL', '');
  vi.stubEnv('DEFAULT_VIDEO_URL', 'https://example.public.blob.vercel-storage.com/defaults/sample.mp4');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-token');
  vi.resetModules();
  const { createApp } = await import('../server/app');
  const { errorHandler } = await import('../server/shared/http');
  const providers: Providers = {
    configured: { openai: true, gemini: false, comfy: false }, models: { openai: 'test', gemini: 'test' },
    openai: vi.fn<Providers['openai']>(async input => ({ caption: 'A caption', description: 'A description', provider: 'openai', model: 'test', start: input.start, end: input.end, basis: 'Sampled frames' })),
    gemini: vi.fn(), voice: vi.fn(), voiceChoice: vi.fn(), enhancePrompt: vi.fn(), enhanceImagePrompt: vi.fn(),
  };
  const app = await createApp({ providers });
  app.use(errorHandler);
  return { app, providers };
}

it.each([undefined, ''])('enables hosted AI tools without a password when APP_PASSWORD is %s', async password => {
  const { app, providers } = await passwordApp('1', password);
  const status = await request(app).get('/api/status').expect(200);
  expect(status.body).toMatchObject({ uploadMode: 'blob', requiresPassword: false, defaultProject: null });
  await request(app).post('/api/session').set('x-sparko-request', '1').expect(200, { ok: true });
  await request(app).post('/api/analyze/openai').set('x-sparko-request', '1')
    .field('start', '0').field('end', '1')
    .field('frames', JSON.stringify([{ time: 0.5, dataUrl: 'data:image/jpeg;base64,YQ==' }])).expect(200);
  expect(providers.openai).toHaveBeenCalledOnce();
  // Upload requests reach validation without requiring a password or contacting Blob.
  await request(app).post('/api/uploads').set('x-sparko-request', '1').send({ type: 'unsupported' })
    .expect(400, { error: 'Unsupported upload action.' });
  await request(app).post('/api/session').expect(403);
  await request(app).post('/api/session').set('x-sparko-request', '1').set('Origin', 'https://untrusted.example').expect(403);
});

it.each(['', '1'])('requires the explicitly configured password when VERCEL is %s', async vercel => {
  const { app, providers } = await passwordApp(vercel, 'workspace-secret');
  const status = await request(app).get('/api/status').expect(200);
  expect(status.body.requiresPassword).toBe(true);
  expect(status.text).not.toContain('workspace-secret');
  for (const password of ['', 'wrong-password']) {
    for (const endpoint of ['/api/session', '/api/uploads', '/api/analyze/openai']) {
      await request(app).post(endpoint).set('x-sparko-request', '1').set('x-sparko-password', password).expect(401);
    }
  }
  expect(providers.openai).not.toHaveBeenCalled();
  await request(app).post('/api/session').set('x-sparko-request', '1').set('x-sparko-password', 'workspace-secret').expect(200, { ok: true });
});

it('uses the bundled sample locally without weakening upload origin checks', async () => {
  vi.stubEnv('DEFAULT_PROJECT_URL', 'https://example.public.blob.vercel-storage.com/defaults/example.sparko');
  vi.stubEnv('DEFAULT_VIDEO_URL', '');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-token');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_PASSWORD', '');
  vi.resetModules();
  const { validateBlobUrl } = await import('../server/hosting');
  expect(validateBlobUrl('https://example.public.blob.vercel-storage.com/transient/clip.mp4')).toContain('/transient/clip.mp4');
  for (const url of ['https://other.public.blob.vercel-storage.com/transient/clip.mp4',
    'http://example.public.blob.vercel-storage.com/transient/clip.mp4',
    'https://example.public.blob.vercel-storage.com/defaults/example.sparko',
    'https://user:password@example.public.blob.vercel-storage.com/transient/clip.mp4']) {
    expect(() => validateBlobUrl(url)).toThrow(/workspace/);
  }
  const { createApp } = await import('../server/app');
  const app = await createApp();
  const status = await request(app).get('/api/status').expect(200);
  expect(status.body.defaultProject).toEqual({ url: '/media/sample.sparko' });
  expect(status.text).not.toContain('test-token');
  await request(app).post('/api/uploads').set('x-sparko-request', '1').send({ type: 'unsupported' }).expect(400);
});
