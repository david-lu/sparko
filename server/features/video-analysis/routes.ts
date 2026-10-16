import type { Express } from 'express';
import { readFile } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import { z } from 'zod';
import type { Providers } from '../../providers';
import type { Frame } from './providers';
import { authenticate } from '../../hosting';
import { HttpError, requireProvider } from '../../shared/http';
import { videoDuration } from '../../shared/media';
import type { UploadReceiver } from '../../shared/uploads';

const sliceSchema = z.object({
  start: z.coerce.number().finite().nonnegative(), end: z.coerce.number().finite().positive(),
  instructions: z.string().max(2000).default(''),
}).refine(v => v.end > v.start && v.end - v.start <= 120, 'Select a range between 0 and 120 seconds.');
const framesSchema = z.array(z.object({
  time: z.number().finite().nonnegative(),
  dataUrl: z.string().max(1_500_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/),
})).min(1).max(24);

export function addAnalysisRoutes(app: Express, providers: Pick<Providers, 'configured' | 'openai' | 'gemini'>, receive: UploadReceiver) {
  app.post('/api/analyze/:provider', authenticate, (req, _res, next) => {
    if (req.params.provider !== 'openai' && req.params.provider !== 'gemini') return next(new HttpError(404, 'Unknown caption provider.'));
    return requireProvider(providers.configured, req.params.provider)(req, _res, next);
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
}
