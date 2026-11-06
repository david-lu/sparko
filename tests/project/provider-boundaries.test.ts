import { afterEach, expect, it, vi } from 'vitest';
import express, { type Response as ExpressResponse } from 'express';
import request from 'supertest';
import { PassThrough } from 'node:stream';
import { createFalClient, falFiles } from '../../server/features/asset-generation/fal';
import { addAssetGenerationRoutes } from '../../server/features/asset-generation/routes';
import { newAssetGeneration } from '../../shared/asset-generation';
import { errorHandler } from '../../server/shared/http';
import { streamMedia, withClientCancellation } from '../../server/shared/streaming';

afterEach(() => vi.restoreAllMocks());
it.each([null, [], 'unexpected', 1])('rejects non-object provider responses', async value => {
  const fal = createFalClient('secret', vi.fn<typeof fetch>().mockResolvedValue(Response.json(value)));
  await expect(fal.status('nano-banana-2', 'request-123')).rejects.toMatchObject({ status: 502 });
});
it.each([null, [], { images: [] }, { images: [null] }, { images: [{ url: 'invalid' }] }, { images: [{ url: 'https://fal.media/image', content_type: { secret: true } }] }])(
  'rejects unusable media records without exposing their contents', value => {
    expect(() => falFiles(value, 'image')).toThrow('fal returned no usable media');
  });
it('handles empty cancellation responses and sanitizes malformed JSON', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response('secret internal error'));
  const fal = createFalClient('secret', transport);
  await expect(fal.cancel('nano-banana-2', 'request-123')).resolves.toEqual({});
  await expect(fal.status('nano-banana-2', 'request-123')).rejects.toMatchObject({ status: 502, message: 'fal returned an unreadable response. Check the existing job before retrying.' });
});
it('propagates browser cancellation into provider reads', async () => {
  const caller = new AbortController();
  const transport = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
  }));
  const pending = createFalClient('secret', transport).status('nano-banana-2', 'request-123', caller.signal);
  const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); caller.abort(); await assertion;
});
it('cancels a paid job accepted after its client disconnected', async () => {
  let connection!: ExpressResponse;
  const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    if (options?.method === 'POST') { connection.destroy(); return Response.json({ request_id: 'accepted-request' }); }
    return new Response(null, { status: 204 });
  });
  const fal = createFalClient('secret', transport), cancel = vi.spyOn(fal, 'cancel');
  const app = express(); app.use((_req, res, next) => { connection = res; next(); });
  addAssetGenerationRoutes(app, fal); app.use(errorHandler);
  const settings = { ...newAssetGeneration('image').settings, prompt: 'A sunset' };
  await expect(request(app).post('/api/library-generations').send({ settings, inputs: [] })).rejects.toThrow();
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(settings.model, 'accepted-request'));
  expect(transport).toHaveBeenCalledTimes(2);
});
it('aborts upstream work on connection close and removes its listener', async () => {
  const res = new PassThrough(), initialListeners = res.listenerCount('close');
  let signal!: AbortSignal;
  const pending = withClientCancellation(res as unknown as ExpressResponse, current => {
    signal = current;
    return new Promise((_resolve, reject) => current.addEventListener('abort', () => reject(current.reason), { once: true }));
  });
  const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  res.emit('close'); await assertion;
  expect(signal.aborted).toBe(true); expect(res.listenerCount('close')).toBe(initialListeners);
});
it('cancels an oversized response before streaming its declared contents', async () => {
  const cancel = vi.fn(), upstream = new Response(new ReadableStream({ cancel }), { headers: { 'content-length': '11' } });
  await expect(streamMedia(upstream, new PassThrough() as unknown as ExpressResponse, 10, 'Too large')).rejects.toMatchObject({ status: 502, message: 'Too large' });
  expect(cancel).toHaveBeenCalledOnce();
});
it('enforces the byte limit when the provider omits content length', async () => {
  const res = new PassThrough(); res.resume();
  await expect(streamMedia(new Response('01234567890'), res as unknown as ExpressResponse, 10, 'Too large')).rejects.toThrow('Too large');
  expect(res.destroyed).toBe(true);
});
