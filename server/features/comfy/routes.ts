import { timelineInputRangesSchema, validateInputRanges } from '../../../shared/generation-inputs.js';
import { videoKeyframeInputsSchema, validateVideoKeyframeInputs } from '../../../shared/video-keyframes.js';
import { generationSeedSchema } from '../../../shared/generation-seed.js';
import express, { type Express } from 'express';
import { H3_MODEL_ID, loraAddressSchema, loraStrengthSchema } from '../../../shared/loras.js';
import { openAsBlob } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';
import { z } from 'zod';
import { COMFY, H3_PROMPT_MAX_LENGTH, INTERSTITIAL, MASK_TRANSITION, TIMELINE_FPS } from '../../../shared/constants.js';
import { H3_PROMPT_LENGTH_ERROR, normalizeH3Prompt } from '../../../shared/h3-prompt.js';
import { comfyBridgePlan, comfyDimensions, validateComfyResolution } from '../../../shared/comfy.js';
import { generationResolutions, maskInjections, normalizeMaskInjection } from '../../../shared/interstitials.js';
import { authenticate } from '../../hosting.js';
import { HttpError, requireProvider } from '../../shared/http.js';
import type { Providers } from '../../providers.js';
import type { UploadReceiver } from '../../shared/uploads.js';
import { comfyRequestError } from './errors.js';
import { parseImageReferences } from './image-references.js';
import { IMAGE_REFERENCE } from '../../../shared/image-references.js';
import { maskCurveSchema } from '../../../shared/mask-curves.js';
import { clipOriginSchema, MAX_CLIP_METADATA_BYTES } from '../../../shared/clip-metadata.js';

const frameRange = z.coerce.number().finite().min(COMFY.minContextFrames / TIMELINE_FPS).max(4)
  .refine(value => Math.abs(value * TIMELINE_FPS - Math.round(value * TIMELINE_FPS)) < 1e-6, 'Reference ranges must use whole 24 fps frames.');
const optionalRange = z.union([frameRange, z.coerce.number().refine(value => value === 0)]);
const maskTransition = z.coerce.number().int().min(0).max(MASK_TRANSITION.maxMs).optional();
const maskCurve = z.preprocess(value => {
  if (typeof value !== 'string' || value.length > 10000) return value;
  try { return JSON.parse(value); } catch { return value; }
}, maskCurveSchema.optional());
const schema = z.object({
  fullInput: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  timelineInputs: z.preprocess(value => { if (typeof value !== 'string' || value.length > 10000) return value; try { return JSON.parse(value); } catch { return value; } }, timelineInputRangesSchema.optional()),
  keyframes: z.preprocess(value => {
    if (typeof value !== 'string' || value.length > 10000) return value;
    try { return JSON.parse(value); } catch { return value; }
  }, videoKeyframeInputsSchema.optional()),
  seed: z.preprocess(value => typeof value === 'string' && value.trim() ? Number(value) : value, generationSeedSchema.optional()),
  lora: loraAddressSchema.optional(),
  turbo: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  clipOrigin: z.preprocess(value => {
    if (typeof value !== 'string' || new TextEncoder().encode(value).length > MAX_CLIP_METADATA_BYTES) return value;
    try { return JSON.parse(value); } catch { return value; }
  }, clipOriginSchema.optional()),
  loraStrength: z.preprocess(value => typeof value === 'string' && value.trim() ? Number(value) : value, loraStrengthSchema.optional()), before: optionalRange, after: optionalRange,
  mode: z.enum(['bridge', 'extend', 'loop', 'custom']).default('bridge'),
  width: z.coerce.number().int().min(32).max(8192).optional(), height: z.coerce.number().int().min(32).max(8192).optional(),
  maskInjection: z.enum(maskInjections).optional(),
  audioMaskTransitionMs: maskTransition, videoMaskTransitionMs: maskTransition,
  audioMaskCurve: maskCurve, videoMaskCurve: maskCurve,
  maskTransitionMs: maskTransition, // Accept older clients' shared duration.
  resolution: z.enum(generationResolutions).optional(),
  startImageIndex: z.coerce.number().int().min(0).max(IMAGE_REFERENCE.maxCount - 1).optional(),
  endImageIndex: z.coerce.number().int().min(0).max(IMAGE_REFERENCE.maxCount - 1).optional(),
  loopImageGuide: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  interpolateMiddle: z.enum(['true', 'false']).optional(),
  duration: z.coerce.number().min(1).max(INTERSTITIAL.maxDuration), prompt: z.string().transform(normalizeH3Prompt)
    .pipe(z.string().min(1).max(H3_PROMPT_MAX_LENGTH, H3_PROMPT_LENGTH_ERROR).refine(value => !!value.trim(), 'Add a prompt before generating.')) })
  .transform(({ interpolateMiddle, maskTransitionMs, ...value }) => ({ ...value,
    audioMaskTransitionMs: value.audioMaskTransitionMs ?? maskTransitionMs ?? MASK_TRANSITION.defaultMs,
    videoMaskTransitionMs: value.videoMaskTransitionMs ?? maskTransitionMs ?? MASK_TRANSITION.defaultMs,
    maskInjection: normalizeMaskInjection(value.maskInjection, interpolateMiddle === 'true') }));
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);

export function addComfyRoutes(app: Express, providers: Providers, receive: UploadReceiver) {
  const requireComfy = requireProvider(providers.configured, 'comfy');
  const provider = () => { if (!providers.comfy) throw new HttpError(503, 'Comfy Cloud is not configured.'); return providers.comfy; };
  app.post('/api/comfy/loras/resolve', authenticate, requireComfy, express.json({ limit: '8kb' }), async (req, res) => {
    const { model, address } = z.object({ model: z.literal(H3_MODEL_ID), address: loraAddressSchema }).parse(req.body);
    res.json({ model, address, name: await provider().resolveLora(address) });
  });
  app.get('/api/comfy/status', authenticate, requireComfy, async (req, res) => {
    const resolution = z.enum(generationResolutions).optional().parse(req.query.resolution);
    const images = z.enum(['true', 'false']).optional().parse(req.query.imageReferences) === 'true';
    const imageLoop = z.enum(['true', 'false']).optional().parse(req.query.imageLoop) === 'true';
    const imageGuides = imageLoop || z.enum(['true', 'false']).optional().parse(req.query.imageGuides) === 'true';
    const turbo = z.enum(['true', 'false']).optional().parse(req.query.turbo) === 'true';
    res.json(await provider().check('standard', resolution, ...(turbo ? [images || imageGuides, imageGuides, false, true] as const : imageGuides ? [true, true] as const : images ? [true] as const : [])));
  });
  app.post('/api/comfy/interstitials', authenticate, requireComfy, ...receive('video'), async (req, res) => {
    const parsed = schema.parse(req.body);
    const images = parseImageReferences(req.body.imageReferences);
    const keyframeImages = parseImageReferences(req.body.keyframeImages);
    const imageArgs: [Blob[], Blob[]] | [Blob[]] | [] = keyframeImages.length ? [images, keyframeImages] : images.length ? [images] : [];
    const settings = parsed;
    for (const [index, footage] of [[settings.startImageIndex, settings.before], [settings.endImageIndex, settings.after]]) {
      if (index !== undefined && (!images[index] || footage)) throw new HttpError(400, 'Choose an uploaded image or video footage for each endpoint.');
    }
    if (settings.mode === 'loop' && settings.startImageIndex !== undefined && settings.endImageIndex !== undefined && settings.startImageIndex !== settings.endImageIndex) throw new HttpError(400, 'A loop uses the same image at both ends.');
    if (settings.loopImageGuide && !images.length) throw new HttpError(400, 'Choose an image as the shared loop reference.');
    let plan;
    try { plan = comfyBridgePlan(settings.before, settings.after, settings.duration, settings.mode); validateComfyResolution(plan,settings.resolution);
      const imageLoop = settings.mode === 'loop' && !plan.prefixFrames && !plan.suffixFrames && (settings.startImageIndex !== undefined || settings.endImageIndex !== undefined || settings.loopImageGuide !== false && images.length > 0);
      validateInputRanges(settings.timelineInputs ?? [], plan.middleFrames);
      if ((settings.timelineInputs?.length || settings.keyframes?.some(k => k.method === 'frame')) && !settings.fullInput) throw new Error('Prepare the complete timeline input before generating.');
      validateVideoKeyframeInputs(settings.keyframes ?? [], plan.middleFrames, keyframeImages.length, imageLoop || settings.startImageIndex !== undefined, imageLoop || settings.endImageIndex !== undefined);
    }
    catch (error) { throw new HttpError(400, (error as Error).message); }
    if (Math.round(settings.before * TIMELINE_FPS) !== plan.prefixFrames || Math.round(settings.after * TIMELINE_FPS) !== plan.suffixFrames) throw new HttpError(400, 'Prepare the Comfy reference on the H3 frame grid.');
    if (!plan.prefixFrames && !plan.suffixFrames && !settings.fullInput) {
      if (!settings.width || !settings.height) throw new HttpError(400, 'Set the video dimensions for generation without references.');
      const job = await provider().submit(undefined, { ...settings, ...comfyDimensions(settings.width, settings.height, settings.resolution), hasAudio: false }, ...imageArgs);
      if (res.destroyed) { await provider().cancel(job.requestId).catch(() => undefined); return; }
      res.status(202).json(job); return;
    }
    if (!req.file || req.file.mimetype !== 'video/mp4' || req.file.size > INTERSTITIAL.maxReferenceBytes) throw new HttpError(400, 'Upload an MP4 reference smaller than 50 MB.');
    const file = await openAsBlob(req.file.path, { type: 'video/mp4' });
    const media = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    let dimensions, hasAudio: boolean;
    try {
      const video = await media.getPrimaryVideoTrack();
      if (!video) throw new HttpError(400, 'The reference must contain video.');
      const duration = await media.computeDuration();
      const stats = await video.computePacketStats(100);
      if (Math.abs(duration - (settings.fullInput ? plan.totalFrames / TIMELINE_FPS : settings.before + settings.after)) > 0.1 || Math.abs(stats.averagePacketRate - TIMELINE_FPS) > 0.01) throw new HttpError(400, 'The reference must contain exactly the two context windows at 24 fps.');
      dimensions = comfyDimensions(video.displayWidth, video.displayHeight, settings.resolution);
      hasAudio = !!await media.getPrimaryAudioTrack();
      if (settings.fullInput && Math.abs(await video.computeDuration() - plan.totalFrames / TIMELINE_FPS) > 1 / TIMELINE_FPS + .001) throw new HttpError(400, 'The input video must cover the complete generation timeline.');
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, 'Unable to read the Comfy reference MP4.');
    } finally { media.dispose(); }
    if (res.destroyed) return;
    const job = await provider().submit(file, { ...settings, ...dimensions, hasAudio }, ...imageArgs);
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
