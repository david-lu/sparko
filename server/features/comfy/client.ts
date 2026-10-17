import { COMFY } from '../../../shared/constants.js';
import { HttpError } from '../../shared/http.js';
import { comfyRequestError } from './errors.js';

function context(path: string, options: RequestInit) {
  if (path === '/api/object_info') return { operation: 'checking available models', recovery: 'Retry the connection check.' };
  if (path === '/api/v2/assets') return { operation: 'uploading the reference video', recovery: 'Retry uploading the reference.' };
  if (path === '/api/v2/jobs' && options.method === 'POST') return { operation: 'submitting the generation', recovery: 'The job may have been accepted. Check Comfy job history before generating again.' };
  if (path.endsWith('/cancel')) return { operation: 'requesting cancellation', recovery: 'Check this job before submitting a replacement.' };
  if (path.startsWith('/api/v2/assets/')) return { operation: 'loading generated video metadata', recovery: 'Retry loading this result; no new generation is needed.' };
  return { operation: 'checking the generation job', recovery: 'Check this existing job again; no new generation is needed.' };
}

export class ComfyClient {
  readonly baseUrl: string;
  private key: string;
  constructor(env: NodeJS.ProcessEnv, private transport: typeof fetch = fetch) {
    this.key = env.COMFY_CLOUD_API_KEY || env.COMFY_API_KEY || '';
    this.baseUrl = (env.COMFY_BASE_URL || COMFY.baseUrl).trim().replace(/\/$/, '');
  }
  get configured() { return !!this.key; }
  message(value: unknown) {
    let message = typeof value === 'string' ? value : 'The Comfy request failed.';
    if (this.key) message = message.split(this.key).join('[redacted]');
    return message.replace(/https?:\/\/\S+/gi, '[URL]').replace(/(?:Bearer\s+|comfyui-)[^\s,;]+/gi, '[redacted]').slice(0, 1200);
  }
  async response(path: string, options: RequestInit = {}): Promise<Response> {
    if (!this.key) throw new HttpError(503, 'COMFY_CLOUD_API_KEY is missing. Add it to .env and restart the server.');
    // Invalid optional Comfy settings must not prevent the Fal server from starting.
    let base: URL;
    try { base = new URL(this.baseUrl); } catch { throw new HttpError(503, 'COMFY_BASE_URL must be a valid HTTPS endpoint.'); }
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new HttpError(503, 'COMFY_BASE_URL must be an HTTPS endpoint without credentials or query parameters.');
    let response: Response;
    try {
      response = await this.transport(this.baseUrl + path, { ...options, redirect: 'error',
        signal: options.signal || AbortSignal.timeout(120_000), headers: { Authorization: `Bearer ${this.key}`, ...(path === '/api/object_info' ? { 'X-API-Key': this.key } : {}), ...options.headers } });
    } catch (error) {
      const { operation, recovery } = context(path, options);
      throw comfyRequestError(error, operation, recovery);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { message?: string; code?: string } | string; message?: string };
      const detail = typeof body.error === 'object' ? body.error?.message : body.error || body.message;
      throw new HttpError(response.status === 429 ? 429 : response.status === 400 || response.status === 422 ? 422 : 502,
        `Comfy Cloud: ${this.message(detail || `Request failed (${response.status}).`)} (while ${context(path, options).operation})`);
    }
    return response;
  }
  async call<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await this.response(path, options);
    if (response.status === 204) return undefined as T;
    // Do not turn a timed-out or truncated response into a successful empty catalog.
    try { return await response.json() as T; }
    catch (error) {
      const { operation, recovery } = context(path, options);
      throw comfyRequestError(error, operation, recovery);
    }
  }
}
