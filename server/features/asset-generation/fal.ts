import { assetModel, validateAssetSettings, type AssetSettings, type MediaKind } from '../../../shared/asset-generation.js';
import { HttpError } from '../../shared/http.js';
import { z } from 'zod';

export type FalInput = { kind: MediaKind; data: string };
export function falPayload(settings: AssetSettings, references: FalInput[]) {
  const error = validateAssetSettings(settings); if (error) throw new HttpError(400, error);
  const model = assetModel(settings.model)!;
  const images = references.filter(r => r.kind === 'image').map(r => r.data);
  const input: Record<string, unknown> = { prompt: settings.prompt };
  const [w, h] = settings.aspectRatio.split(':').map(Number), edge = settings.resolution === '4K' ? 4096 : settings.resolution === '2K' ? 2048 : 1024;
  const image_size = { width: Math.round((w >= h ? edge : edge * w / h) / 32) * 32, height: Math.round((h >= w ? edge : edge * h / w) / 32) * 32 };
  if (model.id === 'nano-banana-2' || model.id === 'nano-banana-pro') {
    Object.assign(input, { aspect_ratio: settings.aspectRatio, resolution: settings.resolution, num_images: 1, output_format: 'png' });
    for (const kind of ['video', 'audio'] as const) { const reference = references.find(r => r.kind === kind); if (reference) input[`${kind}_url`] = reference.data; }
  } else if (model.id === 'flux-2-pro' || model.id === 'flux-2-max') Object.assign(input, { image_size, output_format: 'png' });
  else if (model.id === 'seedream-4.5') Object.assign(input, { image_size, num_images: 1, max_images: 1 });
  else if (model.id === 'ideogram-v3') Object.assign(input, { image_size: ({ '1:1': 'square_hd', '16:9': 'landscape_16_9', '9:16': 'portrait_16_9', '4:3': 'landscape_4_3', '3:4': 'portrait_4_3' } as const)[settings.aspectRatio], num_images: 1, rendering_speed: 'QUALITY', enable_prompt_expansion: false });
  else if (model.id === 'stable-audio-2.5') {
    const audio = references.find(r => r.kind === 'audio');
    Object.assign(input, audio ? { audio_url: audio.data, total_seconds: settings.duration } : { seconds_total: settings.duration });
  } else { delete input.prompt; Object.assign(input, { text: settings.prompt, duration_seconds: settings.duration }); }
  if (model.kind === 'image' && images.length) input.image_urls = images;
  return { endpoint: references.length && model.editEndpoint ? model.editEndpoint : model.endpoint, input };
}
export function falRequestPath(modelId: string, requestId: string) {
  const model = assetModel(modelId);
  if (!model || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) throw new HttpError(400, 'Invalid generation request.');
  return `${model.endpoint.split('/').slice(0, 2).join('/')}/requests/${requestId}`;
}
export type FalFile = { url: string; content_type?: string };
const objectSchema = z.record(z.string(), z.unknown());
const fileSchema = z.object({ url: z.url(), content_type: z.string().regex(/^(image|video|audio)\/[\w.+-]+$/).optional() });
export function falFiles(body: unknown, kind: MediaKind): FalFile[] {
  const object = objectSchema.safeParse(body);
  if (!object.success) throw new HttpError(502, 'fal returned no usable media.');
  const raw = kind === 'image' ? object.data.images : [kind === 'video' ? object.data.video : object.data.audio];
  const entries = Array.isArray(raw) ? raw.map(file => typeof file === 'string' ? { url: file } : file) : raw;
  const result = z.array(fileSchema).min(1).max(4).safeParse(entries);
  if (!result.success) throw new HttpError(502, 'fal returned no usable media.');
  return result.data;
}
export function createFalClient(key: string, fetcher: typeof fetch = fetch) {
  async function json(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
    const response = await fetcher(`https://queue.fal.run/${path}`, { method, headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(90_000)]), redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      // Never forward provider diagnostics: they may contain inputs or credentials.
      throw new HttpError(response.status === 429 ? 429 : response.status === 422 ? 422 : 502,
        response.status === 429 ? 'fal quota or rate limit reached. Try again later.' : response.status === 401 || response.status === 403 ? 'fal rejected the API key or model access.' : 'fal could not complete this request. Check the inputs or retry.');
    }
    if (response.status === 204 && method === 'PUT') return {};
    let value: unknown;
    try { value = await response.json(); }
    catch { signal?.throwIfAborted(); throw new HttpError(502, 'fal returned an unreadable response. Check the existing job before retrying.'); }
    const result = objectSchema.safeParse(value);
    if (!result.success) throw new HttpError(502, 'fal returned an invalid response.');
    return result.data;
  }
  return {
    async submit(settings: AssetSettings, inputs: FalInput[]) {
      const { endpoint, input } = falPayload(settings, inputs), result = await json(endpoint, 'POST', input);
      if (typeof result.request_id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(result.request_id)) throw new HttpError(502, 'fal returned an invalid request ID.');
      return { requestId: result.request_id as string };
    },
    async status(model: string, id: string, signal?: AbortSignal) {
      const result = await json(`${falRequestPath(model, id)}/status`, 'GET', undefined, signal);
      if (result.error || result.error_type) throw new HttpError(422, 'fal generation failed or was cancelled. Review the inputs before retrying.');
      if (typeof result.status !== 'string' || !['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'].includes(result.status)) throw new HttpError(502, 'Unexpected fal job status.');
      return { phase: result.status === 'IN_QUEUE' ? 'queued' as const : result.status === 'IN_PROGRESS' ? 'rendering' as const : 'ready' as const };
    },
    async result(model: string, id: string, signal?: AbortSignal) { return falFiles(await json(falRequestPath(model, id), 'GET', undefined, signal), assetModel(model)!.kind); },
    async cancel(model: string, id: string) { return json(`${falRequestPath(model, id)}/cancel`, 'PUT'); },
    async content(file: FalFile, signal?: AbortSignal) {
      let url: URL;
      try { url = new URL(file.url); } catch { throw new HttpError(502, 'fal returned an unsupported media URL.'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media'))) throw new HttpError(502, 'fal returned an unsupported media URL.');
      const response = await fetcher(url, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120_000)]), redirect: 'error' });
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new HttpError(502, 'Unable to download the generated asset. Check result to retry.');
      }
      return response;
    },
  };
}
export type FalClient = ReturnType<typeof createFalClient>;
