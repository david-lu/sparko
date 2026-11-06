import type { Response } from 'express';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './http.js';

/** Stop read-only upstream work when its browser connection goes away. */
export async function withClientCancellation<T>(res: Response, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const operation = new AbortController();
  const abort = () => operation.abort();
  res.once('close', abort);
  try {
    if (res.destroyed) abort();
    operation.signal.throwIfAborted();
    return await work(operation.signal);
  } finally { res.off('close', abort); operation.abort(); }
}

/** Bound both declared and streamed lengths; pipeline owns stream teardown. */
export async function streamMedia(upstream: globalThis.Response, res: Response, maxBytes: number, tooLarge: string) {
  if (!upstream.body) throw new HttpError(502, 'The provider returned no media.');
  if (Number(upstream.headers.get('content-length')) > maxBytes) {
    await upstream.body.cancel().catch(() => undefined);
    throw new HttpError(502, tooLarge);
  }
  let bytes = 0;
  const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > maxBytes ? new Error(tooLarge) : null, chunk);
  } });
  await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), limit, res);
}
