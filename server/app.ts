import express from 'express';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProviders, type Providers } from './providers.js';
import { addHostingRoutes, hosted, remoteDefault, remoteProject } from './hosting.js';
import { protectRequests } from './shared/http.js';
import { createUploadReceiver } from './shared/uploads.js';
import { addAnalysisRoutes } from './features/video-analysis/routes.js';
import { addVoiceRoutes } from './features/voice-input/routes.js';
import { addComfyRoutes } from './features/comfy/routes.js';
import { addPromptEnhancementRoutes } from './features/interstitials/prompt-enhancement.js';
import { addAssetGenerationRoutes } from './features/asset-generation/routes.js';
import { createFalClient, type FalClient } from './features/asset-generation/fal.js';
import { addImagePromptEnhancementRoutes } from './features/asset-generation/prompt-enhancement.js';

export async function createApp(options: { root?: string; providers?: Providers; fal?: FalClient } = {}) {
  const root = options.root || process.cwd();
  const providers = options.providers || createProviders(process.env);
  const uploadDir = hosted ? path.join(os.tmpdir(), 'sparko-uploads') : path.join(root, '.data', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  const app = express();
  app.disable('x-powered-by');
  app.use(protectRequests);
  const fal = options.fal ?? (process.env.SPARKO_TEST_MODE !== '1' && process.env.FAL_KEY ? createFalClient(process.env.FAL_KEY) : undefined);
  addAssetGenerationRoutes(app, fal);
  // Up to nine timed image previews alongside the existing scene references.
  app.use('/api/interstitials/enhance-prompt', express.json({ limit: '2mb' }));
  app.use(express.json({ limit: '1mb' }));
  addHostingRoutes(app);
  const receive = createUploadReceiver(uploadDir);
  const defaultPath = path.join(root, 'examples', 'sample.mp4');
  const sampleProjectPath = path.join(root, 'examples', 'sample.sparko');
  const rootLegacyPath = path.join(root, 'episode_mock.mp4');
  const legacyPath = await stat(rootLegacyPath).then(() => rootLegacyPath).catch(() => path.join(root, 'examples', 'episode_mock.mp4'));
  app.get('/api/status', async (_req, res) => {
    const info = await stat(defaultPath).catch(() => null);
    const sampleProject = await stat(sampleProjectPath).catch(() => null);
    res.json({ uploadMode: hosted ? 'blob' : 'local', requiresPassword: !!process.env.APP_PASSWORD,
      providers: { ...providers.configured, fal: !!fal }, models: providers.models,
      defaultVideo: { name: 'sample.mp4', url: hosted ? remoteDefault || '' : info ? '/media/sample.mp4' : remoteDefault || '', size: info?.size || 0 },
      defaultProject: hosted ? remoteProject ? { url: remoteProject } : null : sampleProject ? { url: '/media/sample.sparko' } : remoteProject ? { url: remoteProject } : null });
  });
  if (!hosted) app.get('/media/sample.sparko', (_req, res, next) => {
    res.sendFile(sampleProjectPath, { dotfiles: 'deny' }, error => { if (error) next(error); });
  });
  app.get('/media/sample.mp4', (_req, res, next) => {
    if (remoteDefault) { res.redirect(307, remoteDefault); return; }
    res.sendFile(defaultPath, { acceptRanges: true, dotfiles: 'deny' }, error => { if (error) next(error); });
  });
  if (!hosted) app.get('/media/episode_mock.mp4', (_req, res, next) => {
    res.sendFile(legacyPath, { acceptRanges: true, dotfiles: 'deny' }, error => { if (error) next(error); });
  });
  addAnalysisRoutes(app, providers, receive);
  addVoiceRoutes(app, providers);
  addPromptEnhancementRoutes(app, providers);
  addImagePromptEnhancementRoutes(app, providers);
  addComfyRoutes(app, providers, receive);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));
  return app;
}
