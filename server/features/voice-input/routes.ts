import type { Express, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';
import { MAX_VOICE_BYTES, MAX_VOICE_SECONDS, VOICE_CHOICE } from '../../../shared/constants.js';
import type { Providers } from '../../providers.js';
import { authenticate } from '../../hosting.js';
import { HttpError, requireProvider } from '../../shared/http.js';

const voiceContextSchema = z.object({
  sourceId: z.string().min(1).max(1000), videoTime: z.number().finite().nonnegative(),
  sceneId: z.string().min(1).max(200).optional(), question: z.string().trim().max(2000).optional(),
});

const voiceChoiceContextSchema = z.object({
  question: z.string().trim().max(2000).optional(),
  conditions: z.array(z.object({ id: z.string().min(1).max(200), description: z.string().trim().min(1, 'Describe each condition.').max(500) }))
    .min(1).max(VOICE_CHOICE.maxConditions, `Voice answers support up to ${VOICE_CHOICE.maxConditions} conditions besides the default.`)
    .refine(conditions => new Set(conditions.map(condition => condition.id)).size === conditions.length, 'Condition IDs must be unique.'),
});

/** Rejects anything but a short audio-only recording before it reaches a paid provider. */
async function checkRecording(file: Express.Multer.File | undefined, types: string[], maxSeconds: number) {
  const mimeType = file?.mimetype.split(';')[0];
  if (!file?.size || !mimeType || !types.includes(mimeType)) {
    throw new HttpError(400, `Upload a ${types.length > 1 ? 'WebM, MP4, Ogg or WAV' : 'WAV'} audio recording smaller than 2 MB.`);
  }
  const media = new Input({ source: new BlobSource(new Blob([Uint8Array.from(file.buffer)])), formats: ALL_FORMATS });
  try {
    if (!await media.getPrimaryAudioTrack() || await media.getPrimaryVideoTrack()) throw new Error('Audio only');
    const duration = await media.computeDuration();
    if (!Number.isFinite(duration) || duration < 0.2 || duration > maxSeconds + 0.75) throw new Error('Invalid duration');
  } catch { throw new HttpError(400, `Record an audio answer between 0.2 and ${maxSeconds} seconds.`); }
  finally { media.dispose(); }
  return mimeType;
}
/** Cancels provider work when the client disconnects or the time limit passes. */
async function withAbort<T>(res: Response, milliseconds: number, run: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once('close', abort);
  const timeout = setTimeout(abort, milliseconds);
  try {
    if (res.destroyed) controller.abort();
    return await run(controller.signal);
  } finally { clearTimeout(timeout); res.off('close', abort); }
}

export function addVoiceRoutes(app: Express, providers: Pick<Providers, 'configured' | 'voice' | 'voiceChoice'>) {
  const voiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VOICE_BYTES, files: 1, fields: 1, fieldSize: 16_384, parts: 2 } });
  // Registered before /api/voice/:provider, which would otherwise treat "choice" as a provider name.
  app.post('/api/voice/choice', authenticate, requireProvider(providers.configured, 'hume'), voiceUpload.single('audio'), async (req, res) => {
    let rawContext: unknown;
    try { rawContext = JSON.parse(req.body?.context || 'null'); } catch { throw new HttpError(400, 'Invalid voice context.'); }
    const context = voiceChoiceContextSchema.parse(rawContext);
    await checkRecording(req.file, ['audio/wav'], VOICE_CHOICE.maxSeconds);
    res.json(await withAbort(res, 30_000, signal => providers.voiceChoice({ audio: req.file!.buffer, context, signal })));
  });
  app.post('/api/voice/:provider', authenticate, (req, _res, next) => {
    if (req.params.provider !== 'openai' && req.params.provider !== 'gemini') return next(new HttpError(404, 'Unknown voice provider.'));
    return requireProvider(providers.configured, req.params.provider)(req, _res, next);
  }, voiceUpload.single('audio'), async (req, res) => {
    let rawContext: unknown;
    try { rawContext = JSON.parse(req.body?.context || 'null'); } catch { throw new HttpError(400, 'Invalid voice context.'); }
    const context = voiceContextSchema.parse(rawContext);
    const mimeType = await checkRecording(req.file, ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav'], MAX_VOICE_SECONDS);
    res.json(await withAbort(res, 240_000, signal => providers.voice(req.params.provider === 'openai' ? 'openai' : 'gemini', {
      audio: req.file!.buffer, mimeType, context, signal,
    })));
  });
}
