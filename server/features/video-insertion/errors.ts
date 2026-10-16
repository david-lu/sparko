import { ApiError } from '@fal-ai/client';
import { HttpError } from '../../shared/http';

/** Expose fal's validation explanation, never the SDK error, input, headers or URLs. */
export async function falRequest<T>(request: () => Promise<T>, credential?: string): Promise<T> {
  try { return await request(); }
  catch (error) {
    if (!(error instanceof ApiError) || ![400, 422].includes(error.status)) throw error;
    const clean = (message: string) => {
      let text = message;
      for (const secret of [credential, ...(credential?.split(':') ?? [])]) {
        if (secret && secret.length >= 8) text = text.split(secret).join('[redacted]');
      }
      return text.replace(/(?:https?:\/\/|data:)[^\s"<>]+/gi, '[URL]')
        .replace(/\b(?:Bearer|Key)\s+[^\s,;]+/gi, '[redacted]')
        .replace(/[\r\n\t]+/g, ' ').slice(0, 500);
    };
    const body: unknown = error.body;
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : undefined;
    const messages = typeof detail === 'string' ? [clean(detail)] : Array.isArray(detail) ? detail.slice(0, 4).flatMap(issue => {
      if (!issue || typeof issue !== 'object' || typeof issue.msg !== 'string') return [];
      // Pydantic's `input` and `ctx` fields can contain the full submitted payload.
      return [clean(issue.msg)];
    }) : [];
    const explanation = [...new Set(messages)].filter(Boolean).join(' ');
    const requestId = /^[A-Za-z0-9_-]{8,128}$/.test(error.requestId) ? ` Request: ${error.requestId}.` : '';
    throw new HttpError(422, `fal.ai rejected the request: ${explanation || 'no validation details were returned; check the request in the fal dashboard.'}${requestId}`);
  }
}
