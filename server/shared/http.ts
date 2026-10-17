import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AppStatus } from '../../shared/contracts.js';
import { hosted } from '../hosting.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function requireProvider(configured: AppStatus['providers'], provider: keyof AppStatus['providers']): RequestHandler {
  return (_req, _res, next) => {
    if (!configured[provider]) next(new HttpError(503, (provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'gemini' ? 'GEMINI_KEY' : provider === 'comfy' ? 'COMFY_CLOUD_API_KEY' : 'FAL_KEY') + ' is missing. Add it to .env and restart the server.'));
    else next();
  };
}

export const protectRequests: RequestHandler = (req, res, next) => {
  // Local application: reject DNS rebinding and cross-site requests that could spend API credits.
  if (!hosted && req.hostname !== 'localhost' && req.hostname !== '127.0.0.1' && req.hostname !== '[::1]') {
    res.status(403).json({ error: 'This app accepts local connections only.' }); return;
  }
  const origin = req.get('origin');
  if (origin && origin !== `${hosted ? 'https' : 'http'}://${req.get('host')}`) {
    res.status(403).json({ error: 'Cross-origin requests are not allowed.' }); return;
  }
  if (req.path.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method) && req.get('x-sparko-request') !== '1') {
    res.status(403).json({ error: 'Missing application request header.' }); return;
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent || res.destroyed) return;
  let status = 500;
  let message = 'The request failed. Please try again.';
  if (error instanceof z.ZodError) { status = 400; message = error.issues.map(issue => issue.message).join(' '); }
  else if (error instanceof multer.MulterError) { status = 400; message = error.code === 'LIMIT_FILE_SIZE' ? (req.path.startsWith('/api/voice/') ? 'The recording exceeds the 2 MB upload limit.' : 'The video exceeds the 256 MB upload limit.') : 'The upload could not be read.'; }
  else if (error instanceof HttpError) { status = error.status; message = error.message; }
  else if (error?.name === 'AbortError' || error?.name === 'TimeoutError') { status = 504; message = 'The request timed out or was cancelled. Try a shorter segment.'; }
  else if (error?.status === 401 || error?.status === 403) { status = 502; message = 'The provider rejected the API key or model access. Check your .env configuration.'; }
  else if (error?.status === 429) { status = 429; message = 'The provider quota or rate limit was reached. Check your account credits and try again.'; }
  else if (error?.status === 422 || error?.status === 400) { status = 422; message = 'The provider rejected the request. Check the selected model, source video, and time range.'; }
  else if (error?.code === 'ENOENT') { status = 404; message = 'The sample video was not found. Place sample.mp4 in the examples folder.'; }
  // Never serialize provider errors: they can include request headers or credentials.
  res.status(status).json({ error: message });
};
