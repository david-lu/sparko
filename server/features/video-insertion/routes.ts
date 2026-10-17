import type { Express } from 'express';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { INTERSTITIAL } from '../../../shared/constants.js';
import type { Providers } from '../../providers.js';
import { authenticate, remoteDefault, validateBlobUrl, downloadRemote } from '../../hosting.js';
import { HttpError, requireProvider } from '../../shared/http.js';
import { videoDuration } from '../../shared/media.js';
import type { UploadReceiver } from '../../shared/uploads.js';

const falSchema = z.object({
  start: z.coerce.number().finite().nonnegative(), resume: z.coerce.number().finite().nonnegative(),
  duration: z.coerce.number().finite().positive().max(30), resolution: z.enum(['480p', '768p']).default('768p'),
  prompt: z.string().trim().max(4000).default(''), source: z.enum(['default', 'upload']),
}).refine(v => v.resume >= v.start, 'Resume time must be at or after the insertion time.');

export function addInsertionRoutes(app: Express, providers: Pick<Providers, 'configured' | 'falUpload' | 'falSubmit' | 'falStatus' | 'falCancel'>,
  receive: UploadReceiver, defaultPath: string, uploadDir: string) {
  app.post('/api/fal/jobs', authenticate, requireProvider(providers.configured, 'fal'), ...receive('video'), async (req, res) => {
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
      enable_prompt_expansion: INTERSTITIAL.enablePromptExpansion, color_match: true,
    });
    res.status(202).json({ requestId, status: 'IN_QUEUE' });
  });
  app.param('requestId', (_req, _res, next, value: string) => {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) next(new HttpError(400, 'Invalid request ID.'));
    else next();
  });
  app.get('/api/fal/jobs/:requestId', authenticate, requireProvider(providers.configured, 'fal'), async (req, res) => res.json(await providers.falStatus(String(req.params.requestId))));
  app.delete('/api/fal/jobs/:requestId', authenticate, requireProvider(providers.configured, 'fal'), async (req, res) => {
    await providers.falCancel(String(req.params.requestId));
    res.json({ requestId: req.params.requestId, status: 'CANCELLED' });
  });
}
