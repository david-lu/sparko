import express, { type Express } from 'express';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { assetSettingsSchema, mediaKindSchema } from '../../../shared/asset-generation.js';
import { authenticate } from '../../hosting.js';
import { HttpError } from '../../shared/http.js';
import type { FalClient } from './fal.js';

const inputSchema = z.object({ settings: assetSettingsSchema,
  inputs: z.array(z.object({ kind: mediaKindSchema, data: z.string().max(21 * 1024 ** 2).regex(/^data:(image|video|audio)\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/) })).max(16),
}).refine(v => v.inputs.length === v.settings.references.length && v.inputs.every((input, i) => input.kind === v.settings.references[i].kind && input.data.startsWith(`data:${input.kind}/`)), 'Reference inputs do not match.');
export function addAssetGenerationRoutes(app: Express, fal?: FalClient) {
  const root = '/api/library-generations';
  app.use(root, authenticate, express.json({ limit: '48mb' }), (_req, _res, next) => fal ? next() : next(new HttpError(503, 'FAL_KEY is missing. Add it to .env and restart the server.')));
  app.post(root, async (req, res) => { const input = inputSchema.parse(req.body); res.json(await fal!.submit(input.settings, input.inputs)); });
  app.get(`${root}/:model/:id`, async (req, res) => {
    const status = await fal!.status(req.params.model, req.params.id);
    res.json({ ...status, ...(status.phase === 'ready' ? { count: (await fal!.result(req.params.model, req.params.id)).length } : {}) });
  });
  app.delete(`${root}/:model/:id`, async (req, res) => { await fal!.cancel(req.params.model, req.params.id); res.json({ cancelled: true }); });
  app.get(`${root}/:model/:id/content/:index`, async (req, res) => {
    const index = z.coerce.number().int().min(0).max(3).parse(req.params.index);
    const files = await fal!.result(req.params.model, req.params.id), file = files[index];
    if (!file) throw new HttpError(404, 'Generated output not found.');
    const remote = await fal!.content(file), mime = remote.headers.get('content-type')?.split(';')[0] || file.content_type;
    if (!mime || !/^(image|video|audio)\//.test(mime)) throw new HttpError(502, 'fal returned invalid media.');
    res.setHeader('Content-Type', mime); res.setHeader('Cache-Control', 'private, no-store');
    let bytes = 0;
    const limit = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; callback(bytes > 256 * 1024 ** 2 ? new Error('Generated asset exceeds 256 MB.') : null, chunk); } });
    await pipeline(Readable.fromWeb(remote.body as import('node:stream/web').ReadableStream), limit, res);
  });
}
