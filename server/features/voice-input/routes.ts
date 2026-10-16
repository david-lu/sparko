import type { Express } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';
import { MAX_VOICE_BYTES, MAX_VOICE_SECONDS } from '../../../shared/constants';
import type { Providers } from '../../providers';
import { authenticate } from '../../hosting';
import { HttpError, requireProvider } from '../../shared/http';

const voiceContextSchema = z.object({
  sourceId: z.string().min(1).max(1000), videoTime: z.number().finite().nonnegative(),
  sceneId: z.string().min(1).max(200).optional(), question: z.string().trim().max(2000).optional(),
});

export function addVoiceRoutes(app: Express, providers: Pick<Providers, 'configured' | 'voice'>) {
  const voiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VOICE_BYTES, files: 1, fields: 1, fieldSize: 16_384, parts: 2 } });
  app.post('/api/voice/:provider', authenticate, (req, _res, next) => {
    if (req.params.provider !== 'openai' && req.params.provider !== 'gemini') return next(new HttpError(404, 'Unknown voice provider.'));
    return requireProvider(providers.configured, req.params.provider)(req, _res, next);
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
}
