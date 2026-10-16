import type { Express } from 'express';
import { openAsBlob } from 'node:fs';
import { z } from 'zod';
import { INTERSTITIAL } from '../../../shared/constants';
import { referenceResumeTime } from '../../../shared/interstitials';
import { authenticate } from '../../hosting';
import type { Providers } from '../../providers';
import { HttpError, requireProvider } from '../../shared/http';
import { videoDuration } from '../../shared/media';
import type { UploadReceiver } from '../../shared/uploads';

const schema = z.object({
  start: z.coerce.number().finite().min(INTERSTITIAL.minStartRange).max(INTERSTITIAL.maxRange + 0.1),
  resume: z.coerce.number().finite().positive(), fps: z.coerce.number().refine(value => value === INTERSTITIAL.referenceFps, 'Prepare the reference at 24 fps. Refresh the app and try again.'),
  prompt: z.string().trim().min(1, 'Describe the interstitial before generating.').max(4000),
}).refine(value => Math.abs(value.start * INTERSTITIAL.referenceFps - Math.round(value.start * INTERSTITIAL.referenceFps)) < 1e-6
  && Math.abs(value.resume - referenceResumeTime(value.start)) < 1e-6,
  'Reference insertion must span at least one frame on fal.ai\'s 24 fps timeline. Refresh the app and prepare the reference again.');

export function addInterstitialRoutes(app: Express, providers: Pick<Providers, 'configured' | 'falUpload' | 'falSubmit' | 'falCancel'>, receive: UploadReceiver) {
  app.post('/api/interstitials', authenticate, requireProvider(providers.configured, 'fal'), ...receive('video'), async (req, res) => {
    const input = schema.parse(req.body);
    if (!req.file || req.file.mimetype !== 'video/mp4' || req.file.size > INTERSTITIAL.maxReferenceBytes) throw new HttpError(400, 'Upload an MP4 reference clip smaller than 50 MB.');
    const file = await openAsBlob(req.file.path, { type: 'video/mp4' });
    const duration = await videoDuration(file);
    if (duration > INTERSTITIAL.maxRange * 2 + 0.2 || duration - input.start > INTERSTITIAL.maxRange + 0.1 || duration - input.resume < Math.max(1 / input.fps, 1 / INTERSTITIAL.referenceFps) - 1e-6) throw new HttpError(400, 'The reference must contain up to 4 seconds on each side, with footage after the insertion.');
    const videoUrl = await providers.falUpload(file);
    if (res.destroyed) return;
    const requestId = await providers.falSubmit({ video_url: videoUrl, start_time: input.start, resume_time: input.resume,
      prompt: input.prompt, duration: INTERSTITIAL.generatedSeconds, resolution: INTERSTITIAL.resolution,
      enable_prompt_expansion: true, color_match: true });
    if (res.destroyed) { await providers.falCancel(requestId).catch(() => undefined); return; }
    res.status(202).json({ requestId, status: 'IN_QUEUE' });
  });
}
