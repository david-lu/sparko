import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer } from 'node:http';
import { createApp, errorHandler } from './app';

const app = await createApp();
const server = createServer(app);
const production = process.argv.includes('--production');
let closeVite: (() => Promise<void>) | undefined;
if (production) {
  app.use(express.static(path.resolve('dist'), { dotfiles: 'deny' }));
  app.get('/', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
  closeVite = () => vite.close();
}
app.use(errorHandler);
server.requestTimeout = 360_000;
const port = Number(process.env.PORT || 3000);
server.listen(port, '127.0.0.1', () => console.log(`Sparko is ready at http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void closeVite?.(); server.close(() => process.exit(0)); });
}
