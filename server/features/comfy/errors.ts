import { HttpError } from '../../shared/http.js';

/** Keep transport diagnostics useful without exposing request URLs, headers or credentials. */
export function comfyRequestError(error: unknown, operation: string, recovery: string) {
  if (error instanceof HttpError) return error;
  const failure = error as { name?: string; code?: unknown; cause?: { code?: unknown } } | undefined;
  const timeout = failure?.name === 'TimeoutError' || failure?.name === 'AbortError';
  const code = failure?.cause?.code ?? failure?.code;
  const diagnostic = typeof code === 'string' && /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_[A-Z_]+)$/.test(code) ? ` (${code})` : '';
  const reason = timeout ? 'timed out' : failure?.name === 'SyntaxError' ? 'returned invalid JSON' : 'connection failed';
  return new HttpError(timeout ? 504 : 502, `Comfy Cloud ${reason} while ${operation}${diagnostic}. ${recovery}`);
}
