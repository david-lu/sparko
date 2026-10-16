import express from 'express';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProviders, type Providers } from './providers';
import { addHostingRoutes, hosted, remoteDefault } from './hosting';
import { protectRequests } from './shared/http';
import { createUploadReceiver } from './shared/uploads';
import { addAnalysisRoutes } from './features/video-analysis/routes';
import { addVoiceRoutes } from './features/voice-input/routes';
import { addInsertionRoutes } from './features/video-insertion/routes';

export async function createApp(options: { root?: string; providers?: Providers } = {}) {
  const root = options.root || process.cwd();
  const providers = options.providers || createProviders(process.env);
  const uploadDir = hosted ? path.join(os.tmpdir(), 'sparko-uploads') : path.join(root, '.data', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  const app = express();
  app.disable('x-powered-by');
  app.use(protectRequests);
  app.use(express.json({ limit: '1mb' }));
  addHostingRoutes(app);
  const receive = createUploadReceiver(uploadDir);
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
  addAnalysisRoutes(app, providers, receive);
  addVoiceRoutes(app, providers);
  addInsertionRoutes(app, providers, receive, defaultPath, uploadDir);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));
  return app;
}
