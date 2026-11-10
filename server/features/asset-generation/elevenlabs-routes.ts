import type { Express, Response } from 'express';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { assetSettingsSchema } from '../../../shared/asset-generation.js';
import { CHARACTER_VOICE_DESCRIPTION_MAX_LENGTH, characterNameSchema } from '../../../shared/characters.js';
import { authenticate } from '../../hosting.js';
import { HttpError } from '../../shared/http.js';
import { generatedVoiceIdPattern, type ElevenLabsClient } from './elevenlabs.js';

const MAX_AUDIO_BYTES = 128 * 1024 ** 2;
/** ElevenLabs needs a description it can act on; very short ones produce generic voices. */
export const voiceDescriptionSchema = z.string().trim().min(20, 'Describe the voice in at least 20 characters.').max(CHARACTER_VOICE_DESCRIPTION_MAX_LENGTH);
const generateSchema = z.object({ settings: assetSettingsSchema });
const voicesSchema = z.object({ search: z.string().trim().max(100).optional(), page: z.string().max(500).regex(/^[A-Za-z0-9_=:.+/-]*$/).optional() });
const designSchema = z.object({ description: voiceDescriptionSchema });
const createSchema = z.object({ name: characterNameSchema, description: voiceDescriptionSchema, generatedVoiceId: z.string().regex(generatedVoiceIdPattern) });

/** Cancel the provider request when the browser disconnects before the response ends. */
function requestSignal(res: Response) {
  const operation = new AbortController();
  res.once('close', () => { if (!res.writableEnded) operation.abort(); });
  return operation.signal;
}
export function addElevenLabsRoutes(app: Express, client?: ElevenLabsClient) {
  const root = '/api/elevenlabs';
  app.use(root, authenticate, (_req, _res, next) => client ? next() : next(new HttpError(503, 'ELEVENLABS_API_KEY is missing. Add it to .env and restart the server.')));
  /** ElevenLabs answers synchronously, so the audio streams straight back to the browser. */
  app.post(`${root}/audio`, async (req, res) => {
    const { settings } = generateSchema.parse(req.body), remote = await client!.generate(settings, requestSignal(res));
    const type = remote.headers.get('content-type')?.split(';')[0].trim(), mime = type && /^audio\/[a-z0-9.+-]+$/i.test(type) ? type : 'audio/mpeg';
    res.setHeader('Content-Type', mime); res.setHeader('Cache-Control', 'private, no-store');
    let bytes = 0;
    const limit = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; callback(bytes > MAX_AUDIO_BYTES ? new Error('Generated audio exceeds 128 MB.') : null, chunk); } });
    await pipeline(Readable.fromWeb(remote.body as import('node:stream/web').ReadableStream), limit, res);
  });
  app.get(`${root}/voices`, async (req, res) => {
    const query = voicesSchema.parse(req.query);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await client!.voices({ search: query.search || undefined, pageToken: query.page || undefined }, requestSignal(res)));
  });
  app.post(`${root}/voices/design`, async (req, res) => {
    const { description } = designSchema.parse(req.body);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await client!.designVoice(description, requestSignal(res)));
  });
  /** Saves a designed preview to the ElevenLabs account so dialogue can use it. */
  app.post(`${root}/voices`, async (req, res) => {
    const input = createSchema.parse(req.body);
    res.json(await client!.createVoice(input, requestSignal(res)));
  });
}
