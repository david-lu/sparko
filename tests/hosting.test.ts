import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

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
