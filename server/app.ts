import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';
import { createProviders, type Providers, type Frame } from './providers';
import { MAX_VOICE_BYTES, MAX_VOICE_SECONDS } from '../shared/constants';
import { addHostingRoutes, authenticate, hosted, remoteDefault, receiveHosted, validateBlobUrl, downloadRemote } from './hosting';

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const sliceSchema = z.object({
  start: z.coerce.number().finite().nonnegative(), end: z.coerce.number().finite().positive(),
  instructions: z.string().max(2000).default(''),
}).refine(v => v.end > v.start && v.end - v.start <= 120, 'Select a range between 0 and 120 seconds.');
const framesSchema = z.array(z.object({
  time: z.number().finite().nonnegative(),
  dataUrl: z.string().max(1_500_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/),
})).min(1).max(24);
const voiceContextSchema = z.object({
  sourceId: z.string().min(1).max(1000), videoTime: z.number().finite().nonnegative(),
  sceneId: z.string().min(1).max(200).optional(), question: z.string().trim().max(2000).optional(),
});
const falSchema = z.object({
  start: z.coerce.number().finite().nonnegative(), resume: z.coerce.number().finite().nonnegative(),
  duration: z.coerce.number().finite().positive().max(30), resolution: z.enum(['480p', '768p']).default('768p'),
  prompt: z.string().trim().max(4000).default(''), source: z.enum(['default', 'upload']),
}).refine(v => v.resume >= v.start, 'Resume time must be at or after the insertion time.');

export async function videoDuration(blob: Blob): Promise<number> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    if (!await input.getPrimaryVideoTrack()) throw new HttpError(400, 'The file must contain a video track.');
    return await input.computeDuration();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'This video could not be read. Use a valid MP4, MOV, or WebM file.');
  } finally { input.dispose(); }
}

export async function createApp(options: { root?: string; providers?: Providers } = {}) {
  const root = options.root || process.cwd();
  const providers = options.providers || createProviders(process.env);
  const uploadDir = hosted ? path.join(os.tmpdir(), 'sparko-uploads') : path.join(root, '.data', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    // Local application: reject DNS rebinding and cross-site requests that could spend API credits.
    if (!hosted && req.hostname !== 'localhost' && req.hostname !== '127.0.0.1' && req.hostname !== '[::1]') {
      res.status(403).json({ error: 'This app accepts local connections only.' }); return;
    }
    const origin = req.get('origin');
    if (origin && origin !== `${hosted ? 'https' : 'http'}://${req.get('host')}`) {
      res.status(403).json({ error: 'Cross-origin requests are not allowed.' }); return;
    }
    if (req.path.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method) && req.get('x-sparko-request') !== '1') {
      res.status(403).json({ error: 'Missing application request header.' }); return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  addHostingRoutes(app);
  const upload = multer({ dest: uploadDir, limits: { fileSize: 256 * 1024 * 1024, files: 1, fields: 12, fieldSize: 24 * 1024 * 1024 } });
  const receive = (field: string) => [
    // Install cleanup before Multer so aborted requests and parsing failures also clean up.
    ((req, res, next) => {
      const clean = () => { if (req.file) void rm(req.file.path, { force: true }).catch(() => undefined); };
      res.once('finish', clean);
      res.once('close', clean);
      next();
    }) as express.RequestHandler,
    upload.single(field),
    receiveHosted(uploadDir, field),
  ];
  const requireProvider = (provider: keyof Providers['configured']): express.RequestHandler => (_req, _res, next) => {
    if (!providers.configured[provider]) next(new HttpError(503, `${provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'gemini' ? 'GEMINI_KEY' : 'FAL_KEY'} is missing. Add it to .env and restart the server.`));
    else next();
  };
  const defaultPath = path.join(root, 'episode_mock.mp4');
  app.get('/api/status', async (_req, res) => {
    const info = await stat(defaultPath).catch(() => null);
    res.json({ uploadMode: hosted ? 'blob' : 'local', requiresPassword: hosted || !!process.env.APP_PASSWORD,
      providers: providers.configured, models: providers.models, defaultVideo: { name: 'episode_mock.mp4', url: remoteDefault || '/media/episode_mock.mp4', size: info?.size || 0 } });
  });
  app.get('/media/episode_mock.mp4', (_req, res, next) => {
    if (remoteDefault) { res.redirect(307, remoteDefault); return; }
    res.sendFile(defaultPath, { acceptRanges: true, dotfiles: 'deny' }, error => { if (error) next(error); });
  });
  app.post('/api/analyze/:provider', authenticate, (req, _res, next) => {
    if (req.params.provider !== 'openai' && req.params.provider !== 'gemini') return next(new HttpError(404, 'Unknown caption provider.'));
    return requireProvider(req.params.provider)(req, _res, next);
  }, ...receive('media'), async (req, res) => {
    const input = sliceSchema.parse(req.body);
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.once('close', abort);
    const timeout = setTimeout(abort, 300_000);
    try {
      if (req.params.provider === 'openai') {
        let rawFrames: unknown;
        try { rawFrames = JSON.parse(req.body.frames || 'null'); } catch { throw new HttpError(400, 'Invalid video frames.'); }
        const frames: Frame[] = framesSchema.parse(rawFrames);
        if (frames.some(f => f.time < input.start || f.time >= input.end)) throw new HttpError(400, 'Frame timestamps must fall inside the selected segment.');
        if (req.file && (req.file.size > 24 * 1024 * 1024 || !['audio/wav', 'audio/wave', 'audio/x-wav'].includes(req.file.mimetype))) throw new HttpError(400, 'Audio must be a WAV file smaller than 24 MB.');
        const audio = req.file ? await readFile(req.file.path) : undefined;
        res.json(await providers.openai({ ...input, frames, audio, signal: controller.signal }));
      } else {
        if (!req.file || req.file.mimetype !== 'video/mp4' || req.file.size > 100 * 1024 * 1024) throw new HttpError(400, 'Upload an MP4 segment smaller than 100 MB.');
        const duration = await videoDuration(await openAsBlob(req.file.path));
        if (duration > 120.25 || Math.abs(duration - (input.end - input.start)) > 0.5) throw new HttpError(400, 'The uploaded clip does not match the requested time range.');
        res.json(await providers.gemini({ ...input, videoPath: req.file.path, signal: controller.signal }));
      }
    } finally {
      clearTimeout(timeout);
      res.off('close', abort);
    }
  });
  const voiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VOICE_BYTES, files: 1, fields: 1, fieldSize: 16_384, parts: 2 } });
  app.post('/api/voice/:provider', authenticate, (req, _res, next) => {
    if (req.params.provider !== 'openai' && req.params.provider !== 'gemini') return next(new HttpError(404, 'Unknown voice provider.'));
    return requireProvider(req.params.provider)(req, _res, next);
  }, voiceUpload.single('audio'), async (req, res) => {
    let rawContext: unknown;
    try { rawContext = JSON.parse(req.body?.context || 'null'); } catch { throw new HttpError(400, 'Invalid voice context.'); }
    const context = voiceContextSchema.parse(rawContext);
    const mimeType = req.file?.mimetype.split(';')[0];
    if (!req.file?.size || !mimeType || !['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav'].includes(mimeType)) {
      throw new HttpError(400, 'Upload a WebM, MP4, Ogg or WAV audio recording smaller than 2 MB.');
    }
    const media = new Input({ source: new BlobSource(new Blob([Uint8Array.from(req.file.buffer)])), formats: ALL_FORMATS });
    try {
      if (!await media.getPrimaryAudioTrack() || await media.getPrimaryVideoTrack()) throw new Error('Audio only');
      const duration = await media.computeDuration();
      if (!Number.isFinite(duration) || duration < 0.2 || duration > MAX_VOICE_SECONDS + 0.75) throw new Error('Invalid duration');
    } catch { throw new HttpError(400, `Record an audio answer between 0.2 and ${MAX_VOICE_SECONDS} seconds.`); }
    finally { media.dispose(); }
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.once('close', abort);
    const timeout = setTimeout(abort, 240_000);
    try {
      if (res.destroyed) controller.abort();
      res.json(await providers.voice(req.params.provider === 'openai' ? 'openai' : 'gemini', {
        audio: req.file.buffer, mimeType, context, signal: controller.signal,
      }));
    } finally { clearTimeout(timeout); res.off('close', abort); }
  });
  app.post('/api/fal/jobs', authenticate, requireProvider('fal'), ...receive('video'), async (req, res) => {
    const input = falSchema.parse(req.body);
    if (input.source === 'upload' && !req.file) throw new HttpError(400, 'Choose a video to upload.');
    let filePath = input.source === 'default' ? defaultPath : req.file!.path;
    if (input.source === 'default' && remoteDefault) {
      filePath = path.join(uploadDir, randomUUID());
      await downloadRemote(validateBlobUrl(remoteDefault, false), filePath, 256 * 1024 * 1024);
      req.file = { path: filePath } as Express.Multer.File;
    }
    const mime = input.source === 'default' ? 'video/mp4' : req.file!.mimetype;
    if (!['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'].includes(mime)) throw new HttpError(400, 'Use an MP4, MOV, MKV, or WebM video.');
    const file = await openAsBlob(filePath, { type: mime });
    const duration = await videoDuration(file);
    if (input.start >= duration || input.resume > duration) throw new HttpError(400, 'Insertion and resume times must fall within the video.');
    const videoUrl = await providers.falUpload(file);
    const requestId = await providers.falSubmit({
      video_url: videoUrl, start_time: input.start, resume_time: input.resume,
      duration: input.duration, resolution: input.resolution, prompt: input.prompt,
      enable_prompt_expansion: true, color_match: true,
    });
    res.status(202).json({ requestId, status: 'IN_QUEUE' });
  });
  app.param('requestId', (_req, _res, next, value: string) => {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) next(new HttpError(400, 'Invalid request ID.'));
    else next();
  });
  app.get('/api/fal/jobs/:requestId', authenticate, requireProvider('fal'), async (req, res) => res.json(await providers.falStatus(String(req.params.requestId))));
  app.delete('/api/fal/jobs/:requestId', authenticate, requireProvider('fal'), async (req, res) => {
    await providers.falCancel(String(req.params.requestId));
    res.json({ requestId: req.params.requestId, status: 'CANCELLED' });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));
  return app;
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent || res.destroyed) return;
  let status = 500;
  let message = 'The request failed. Please try again.';
  if (error instanceof z.ZodError) { status = 400; message = error.issues.map(issue => issue.message).join(' '); }
  else if (error instanceof multer.MulterError) { status = 400; message = error.code === 'LIMIT_FILE_SIZE' ? (req.path.startsWith('/api/voice/') ? 'The recording exceeds the 2 MB upload limit.' : 'The video exceeds the 256 MB upload limit.') : 'The upload could not be read.'; }
  else if (error instanceof HttpError) { status = error.status; message = error.message; }
  else if (error?.name === 'AbortError' || error?.name === 'TimeoutError') { status = 504; message = 'The request timed out or was cancelled. Try a shorter segment.'; }
  else if (error?.status === 401 || error?.status === 403) { status = 502; message = 'The provider rejected the API key or model access. Check your .env configuration.'; }
  else if (error?.status === 429) { status = 429; message = 'The provider quota or rate limit was reached. Check your account credits and try again.'; }
  else if (error?.status === 422 || error?.status === 400) { status = 422; message = 'The provider rejected the request. Check the selected model, source video, and time range.'; }
  else if (error?.code === 'ENOENT') { status = 404; message = 'The video file was not found. Place episode_mock.mp4 in the project folder.'; }
  // Never serialize provider errors: they can include request headers or credentials.
  res.status(status).json({ error: message });
};
