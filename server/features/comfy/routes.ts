import type { Express } from 'express';
import { openAsBlob } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';
import { z } from 'zod';
import { COMFY, INTERSTITIAL, TIMELINE_FPS } from '../../../shared/constants.js';
import { comfyBridgePlan, comfyDimensions } from '../../../shared/comfy.js';
import { authenticate } from '../../hosting.js';
import { HttpError, requireProvider } from '../../shared/http.js';
import type { Providers } from '../../providers.js';
import type { UploadReceiver } from '../../shared/uploads.js';
import { comfyRequestError } from './errors.js';

const frameRange = z.coerce.number().finite().min(COMFY.minContextFrames / TIMELINE_FPS).max(4)
  .refine(value => Math.abs(value * TIMELINE_FPS - Math.round(value * TIMELINE_FPS)) < 1e-6, 'Reference ranges must use whole 24 fps frames.');
const schema = z.object({ before: frameRange, after: z.union([frameRange, z.coerce.number().refine(value => value === 0)]),
  mode: z.enum(['bridge', 'extend', 'loop']).default('bridge'),
  duration: z.coerce.number().min(1).max(INTERSTITIAL.maxDuration), prompt: z.string().trim().min(1).max(8000) });
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);

export function addComfyRoutes(app: Express, providers: Providers, receive: UploadReceiver) {
  const requireComfy = requireProvider(providers.configured, 'comfy');
  const provider = () => { if (!providers.comfy) throw new HttpError(503, 'Comfy Cloud is not configured.'); return providers.comfy; };
  app.get('/api/comfy/status', authenticate, requireComfy, async (_req, res) => res.json(await provider().check()));
  app.post('/api/comfy/interstitials', authenticate, requireComfy, ...receive('video'), async (req, res) => {
    const parsed = schema.parse(req.body);
    const settings = { ...parsed, prompt: parsed.prompt.replace(/\r\n/g, '\n') };
    let plan;
    try { plan = comfyBridgePlan(settings.before, settings.after, settings.duration, settings.mode); }
    catch (error) { throw new HttpError(400, (error as Error).message); }
    if (Math.round(settings.before * TIMELINE_FPS) !== plan.prefixFrames || Math.round(settings.after * TIMELINE_FPS) !== plan.suffixFrames) throw new HttpError(400, 'Prepare the Comfy reference on the H3 frame grid.');
    if (!req.file || req.file.mimetype !== 'video/mp4' || req.file.size > INTERSTITIAL.maxReferenceBytes) throw new HttpError(400, 'Upload an MP4 reference smaller than 50 MB.');
    const file = await openAsBlob(req.file.path, { type: 'video/mp4' });
    const media = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    let dimensions, hasAudio: boolean;
    try {
      const video = await media.getPrimaryVideoTrack();
      if (!video) throw new HttpError(400, 'The reference must contain video.');
      const duration = await media.computeDuration();
      const stats = await video.computePacketStats(100);
      if (Math.abs(duration - settings.before - settings.after) > 0.1 || Math.abs(stats.averagePacketRate - TIMELINE_FPS) > 0.01) throw new HttpError(400, 'The reference must contain exactly the two context windows at 24 fps.');
      dimensions = comfyDimensions(video.displayWidth, video.displayHeight);
      hasAudio = !!await media.getPrimaryAudioTrack();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, 'Unable to read the Comfy reference MP4.');
    } finally { media.dispose(); }
    if (res.destroyed) return;
    const job = await provider().submit(file, { ...settings, ...dimensions, hasAudio });
    if (res.destroyed) { await provider().cancel(job.requestId).catch(() => undefined); return; }
    res.status(202).json(job);
  });
  app.get('/api/comfy/jobs/:requestId', authenticate, requireComfy, async (req, res) => res.json(await provider().status(idSchema.parse(req.params.requestId))));
  app.get('/api/comfy/jobs/:requestId/events', authenticate, requireComfy, async (req, res) => {
    const requestId = idSchema.parse(req.params.requestId), comfy = provider();
    const operation = new AbortController();
    // Reconnect below Vercel's request deadline; this never cancels the generation job.
    const signal = AbortSignal.any([operation.signal, AbortSignal.timeout(240_000)]);
    const close = () => operation.abort();
    res.once('close', close);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const heartbeat = setInterval(() => { if (!res.destroyed && !res.writableNeedDrain) res.write(': keepalive\n\n'); }, 15_000);
    try {
      for await (const event of comfy.events(requestId, signal)) {
        signal.throwIfAborted();
        if (!res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)) await once(res, 'drain', { signal });
      }
    } catch {
      if (!res.destroyed) res.write('event: fallback\ndata: {}\n\n');
    } finally {
      clearInterval(heartbeat); operation.abort(); res.off('close', close); res.end();
    }
  });
  app.delete('/api/comfy/jobs/:requestId', authenticate, requireComfy, async (req, res) => {
    const requestId = idSchema.parse(req.params.requestId); await provider().cancel(requestId);
    res.json({ requestId, status: 'CANCELLED' });
  });
  // Stable authenticated URL. Resolve a fresh signed URL on every download/retry.
  app.get('/api/comfy/assets/:assetId/content', authenticate, requireComfy, async (req, res) => {
    const assetId = idSchema.parse(req.params.assetId);
    const range = req.get('range');
    if (range && !/^bytes=\d*-\d*$/.test(range)) throw new HttpError(400, 'Invalid media range.');
    const operation = new AbortController();
    res.once('close', () => operation.abort());
    const url = await provider().assetUrl(assetId);
    let upstream: Response;
    try {
      upstream = await fetch(url, { headers: range ? { Range: range } : {}, redirect: 'error', signal: AbortSignal.any([operation.signal, AbortSignal.timeout(120_000)]) });
    } catch (error) { throw comfyRequestError(error, 'downloading the generated video', 'Retry loading this result; no new generation is needed.'); }
    if (!upstream.ok || !upstream.body) throw new HttpError(502, `Comfy media download failed (${upstream.status}). Retry loading.`);
    res.status(upstream.status).set({ 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store' });
    for (const name of ['content-length', 'content-range', 'accept-ranges']) { const value = upstream.headers.get(name); if (value) res.set(name, value); }
    let received = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, done) { received += chunk.length; done(received > 256 * 1024 ** 2 ? new Error('Comfy output exceeds 256 MB.') : null, chunk); } });
    await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), limit, res);
  });
}
