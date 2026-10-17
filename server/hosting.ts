import type { Express, RequestHandler } from 'express';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { handleUpload } from '@vercel/blob/client';
import { del } from '@vercel/blob';
import { z } from 'zod';

export const hosted = process.env.VERCEL === '1';
export const remoteDefault = process.env.DEFAULT_VIDEO_URL;
export const remoteProject = process.env.DEFAULT_PROJECT_URL;
const digest = (value: string) => createHash('sha256').update(value).digest();

export const authenticate: RequestHandler = (req, res, next) => {
  if (!hosted && !process.env.APP_PASSWORD) return next();
  const password = process.env.APP_PASSWORD;
  if (!password) { res.status(503).json({ error: 'Set APP_PASSWORD in the Vercel environment to enable this app.' }); return; }
  if (!timingSafeEqual(digest(req.get('x-sparko-password') || ''), digest(password))) {
    res.status(401).json({ error: 'Enter the workspace password to use the AI tools.' }); return;
  }
  next();
};

// Only accept uploads in this project's Blob store, never arbitrary URLs (SSRF).
export function validateBlobUrl(value: string, temporary = true): string {
  const url = new URL(value);
  const storeUrl = remoteProject || remoteDefault;
  if (!storeUrl) throw new Error('Set DEFAULT_PROJECT_URL or DEFAULT_VIDEO_URL to your sample in Vercel Blob.');
  const expected = new URL(storeUrl);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.public.blob.vercel-storage.com') || url.origin !== expected.origin || url.username || url.password || (temporary && !url.pathname.startsWith('/transient/'))) {
    throw new Error('The uploaded file must belong to this workspace.');
  }
  return url.href;
}

export async function downloadRemote(url: string, destination: string, maxBytes: number): Promise<number> {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error('The uploaded file could not be retrieved.');
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('The uploaded file is too large.');
  let size = 0;
  const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length;
    callback(size > maxBytes ? new Error('The uploaded file is too large.') : null, chunk);
  } });
  try { await pipeline(Readable.fromWeb(response.body as never), limit, createWriteStream(destination)); }
  catch (error) { await rm(destination, { force: true }); throw error; }
  return size;
}

export function addHostingRoutes(app: Express) {
  app.post('/api/session', authenticate, (_req, res) => res.json({ ok: true }));
  app.post('/api/uploads', authenticate, async (req, res) => {
    if (!process.env.BLOB_READ_WRITE_TOKEN || !(remoteProject || remoteDefault)) { res.status(503).json({ error: 'Configure BLOB_READ_WRITE_TOKEN and DEFAULT_PROJECT_URL (or DEFAULT_VIDEO_URL) in Vercel.' }); return; }
    // No upload-completion webhook is needed; the browser sends the final URL to the API.
    if (req.body?.type !== 'blob.generate-client-token') { res.status(400).json({ error: 'Unsupported upload action.' }); return; }
    const result = await handleUpload({ body: req.body, request: req,
      onBeforeGenerateToken: async pathname => {
        if (!/^transient\/[a-f0-9-]+\.(mp4|webm|mov|mkv|wav|json)$/.test(pathname)) throw new Error('Invalid upload path.');
        return { allowedContentTypes: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'audio/wav', 'audio/wave', 'application/json'],
          maximumSizeInBytes: 256 * 1024 * 1024, validUntil: Date.now() + 15 * 60_000, addRandomSuffix: true, allowOverwrite: false };
      },
    });
    res.json(result);
  });
  app.delete('/api/uploads', authenticate, async (req, res) => {
    const urls = z.array(z.string()).max(4).parse(req.body?.urls).map(url => validateBlobUrl(url));
    if (urls.length) await del(urls);
    res.json({ ok: true });
  });
}

/** Adapts direct Blob uploads to the same validated handlers used by local multipart requests. */
export function receiveHosted(uploadDir: string, field: string): RequestHandler {
  return async (req, _res, next) => {
    if (!req.is('application/json')) return next();
    const files: string[] = [];
    const paths: string[] = [];
    try {
      const payloadUrl = validateBlobUrl(z.string().parse(req.body?.payloadUrl));
      files.push(payloadUrl);
      const payloadPath = path.join(uploadDir, randomUUID()); paths.push(payloadPath);
      await downloadRemote(payloadUrl, payloadPath, 30 * 1024 * 1024);
      const payload = z.object({ fields: z.record(z.string(), z.string().max(26_000_000)),
        file: z.object({ url: z.string(), mime: z.string(), name: z.string(), field: z.string() }).optional(),
      }).parse(JSON.parse(await readFile(payloadPath, 'utf8')));
      req.body = payload.fields;
      if (payload.file) {
        if (payload.file.field !== field) throw new Error('Unexpected uploaded file.');
        const url = validateBlobUrl(payload.file.url); files.push(url);
        const filePath = path.join(uploadDir, randomUUID()); paths.push(filePath);
        const size = await downloadRemote(url, filePath, field === 'video' ? 256 * 1024 * 1024 : 100 * 1024 * 1024);
        req.file = { fieldname: field, originalname: payload.file.name, encoding: '7bit', mimetype: payload.file.mime,
          destination: uploadDir, filename: path.basename(filePath), path: filePath, size } as Express.Multer.File;
      }
      await rm(payloadPath, { force: true });
      // Local temporary files are removed after the provider finishes by the upload middleware.
      next();
    } catch (error) {
      await Promise.all(paths.map(file => rm(file, { force: true }).catch(() => undefined)));
      next(error);
    } finally {
      // Provider reads from the local copy, so cloud intermediates can be deleted immediately.
      if (files.length) await del(files).catch(() => undefined);
    }
  };
}
