import { resolveComfyLora } from './loras.js';
import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { GenerationEvent, GenerationJob } from '../../../shared/contracts.js';
import { readServerEvents } from '../../../shared/server-events.js';
import { COMFY_MODELS } from '../../../shared/constants.js';
import { comfyBridgePlan, validateComfyResolution } from '../../../shared/comfy.js';
import { HttpError } from '../../shared/http.js';
import { ComfyClient } from './client.js';
import { bridgeWorkflow, type BridgeInput } from './workflow.js';
import { type MaskInjection, type GenerationResolution } from '../../../shared/interstitials.js';
import { generationProgress, progressSchema } from './progress.js';
import { IMAGE_REFERENCE } from '../../../shared/image-references.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const statusSchema = z.object({ status: z.enum(['queued', 'running', 'succeeded', 'canceling', 'canceled', 'failed', 'expired']), queue_position: z.number().nullable().optional() });
const jobSchema = statusSchema.extend({ id, progress: progressSchema.nullable().optional(),
  outputs: z.array(z.object({ id, node_id: z.string(), content_type: z.string() })).default([]),
  error: z.object({ message: z.string() }).nullable().optional(),
});
export type ComfyReadiness = { ready: boolean; message?: string };
export interface ComfyProvider {
  resolveLora(address: string): Promise<string>;
  check(maskInjection?: MaskInjection, resolution?: GenerationResolution, imageReferences?: boolean, imageGuides?: boolean, lora?: boolean): Promise<ComfyReadiness>;
  submit(file: Blob | undefined, input: BridgeInput, images?: Blob[]): Promise<GenerationJob>;
  status(requestId: string): Promise<GenerationJob>;
  events(requestId: string, signal: AbortSignal): AsyncIterable<GenerationEvent>;
  cancel(requestId: string): Promise<void>;
  assetUrl(assetId: string): Promise<string>;
}

export function createComfyProvider(env: NodeJS.ProcessEnv, transport: typeof fetch = fetch): ComfyProvider {
  const client = new ComfyClient(env, transport);
  const partnerKey = env.COMFY_CLOUD_API_KEY || env.COMFY_API_KEY || '';
  const checks = new Map<string, { promise: Promise<ComfyReadiness>; at: number }>();
  const check = (_legacyMaskInjection: MaskInjection = 'standard', resolution: GenerationResolution = 'native', imageReferences = false, imageGuides = false, lora = false) => {
    if (!client.configured) return Promise.resolve({ ready: false, message: 'Add COMFY_CLOUD_API_KEY to .env and restart the server.' });
    const key = `${resolution}:${imageReferences}:${imageGuides}:${lora}`, cached = checks.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached.promise;
    const promise = (async () => {
      const nodes = await client.call<Record<string, { input?: { required?: Record<string, unknown[]> } }>>('/api/object_info', { signal: AbortSignal.timeout(15_000) });
      const graph = bridgeWorkflow('preflight-asset', { before: 1.625, after: 1.625, mode: 'bridge', duration: 6, prompt: 'Check', width: 960, height: 544, hasAudio: true, resolution }, 0, undefined, imageReferences || imageGuides ? ['preflight-image'] : []);
      // The hard mask is also used when transitions or both references are off.
      const missing = [...new Set([...Object.values(graph).map(node => node.class_type), 'MVEx_FrameRangeMask', ...(imageGuides ? ['MiniMaxH3AddGuide'] : []), ...(lora ? ['LoraLoaderModelOnly'] : [])])].filter(name => !nodes[name]);
      if (missing.length) return { ready: false, message: `Comfy is missing required nodes: ${missing.join(', ')}.` };
      const models = [['UNETLoader', 'unet_name', COMFY_MODELS.diffusion], ['CLIPLoader', 'clip_name', COMFY_MODELS.textEncoder], ['VAELoader', 'vae_name', COMFY_MODELS.videoVae], ['VAELoader', 'vae_name', COMFY_MODELS.audioVae]];
      if (resolution === '2k') models.push(['MinimaxHailuo03RegenerateNode', 'model', COMFY_MODELS.regeneration]);
      for (const [node, field, model] of models) {
        const definition = nodes[node].input?.required?.[field];
        const values = Array.isArray(definition?.[0]) ? definition[0] : (definition?.[1] as { options?: unknown } | undefined)?.options;
        // V3 DynamicCombo options carry a key plus their nested input schema.
        const options = Array.isArray(values) ? values.map(value => typeof value === 'string' ? value : (value as {key?:string})?.key)
          : values && typeof values === 'object' ? Object.keys(values) : undefined;
        if (options && !options.includes(model)) return { ready: false, message: `Comfy is missing model ${model}.` };
      }
      return { ready: true };
    })().catch(error => ({ ready: false, message: client.message(error instanceof Error ? error.message : error) }));
    checks.set(key, { promise, at: Date.now() });
    return promise;
  };
  const status = async (requestId: string): Promise<GenerationJob> => {
    const data = jobSchema.parse(await client.call(`/api/v2/jobs/${encodeURIComponent(id.parse(requestId))}`));
    if (data.status === 'failed' || data.status === 'expired') throw new HttpError(422, `Comfy Cloud: ${client.message(data.error?.message || `The job ${data.status}. Retry generation.`)}`);
    if (data.status === 'canceled') return { requestId, status: 'CANCELLED' };
    if (data.status === 'succeeded') {
      const output = data.outputs.find(output => output.node_id === 'output' && output.content_type === 'video/mp4');
      if (!output) throw new HttpError(502, 'Comfy completed without the expected MP4 output.');
      return { requestId, status: 'COMPLETED', videoUrl: `/api/comfy/assets/${output.id}/content` };
    }
    return { requestId, status: data.status === 'queued' ? 'IN_QUEUE' : 'IN_PROGRESS', queuePosition: data.queue_position ?? undefined,
      ...(data.progress ? generationProgress(data.progress) : {}) };
  };
  return {
    check, status, resolveLora: address => resolveComfyLora(client, address),
    async *events(requestId, signal) {
      const response = await client.response(`/api/v2/jobs/${encodeURIComponent(id.parse(requestId))}/events`, { signal, headers: { Accept: 'text/event-stream' } });
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel();
        throw new HttpError(502, 'Comfy did not return a progress stream.');
      }
      for await (const event of readServerEvents(response.body, signal)) {
        if (event.event === 'progress') yield { type: 'progress', ...generationProgress(progressSchema.parse(JSON.parse(event.data))) };
        else if (event.event === 'status') {
          const data = statusSchema.parse(JSON.parse(event.data));
          if (['succeeded', 'canceled', 'failed', 'expired'].includes(data.status)) { yield { type: 'refresh' }; return; }
          yield { type: 'status', status: data.status === 'queued' ? 'IN_QUEUE' : 'IN_PROGRESS', queuePosition: data.queue_position ?? undefined };
        } else if (event.event === 'error') {
          // A stream failure does not mean the render failed. Reconcile using GET /jobs.
          throw new HttpError(502, 'Comfy progress stream disconnected.');
        }
      }
    },
    async submit(file, input, images = []) {
      if (input.lora) input = { ...input, lora: await resolveComfyLora(client, input.lora) };
      if (images.length > IMAGE_REFERENCE.maxCount || images.some(image => image.type !== 'image/jpeg' || !image.size || image.size > IMAGE_REFERENCE.maxBytes)) throw new HttpError(400, 'Use up to 9 prepared JPEG image references, each smaller than 1 MB.');
      const imageLoop = input.mode === 'loop' && !input.before && !input.after && input.loopImageGuide !== false && images.length > 0;
      const imageGuides = imageLoop || input.startImageIndex !== undefined || input.endImageIndex !== undefined;
      // Validate image guides before uploading assets or submitting a paid job.
      bridgeWorkflow('validation-video', input, 0, undefined, images.map((_, index) => `validation-image-${index}`));
      const readiness = await check('standard', input.resolution, images.length > 0, imageGuides, !!input.lora);
      if (!readiness.ready) throw new HttpError(503, readiness.message || 'Comfy is not ready.');
      const plan = comfyBridgePlan(input.before, input.after, input.duration, input.mode);
      validateComfyResolution(plan,input.resolution);
      // Comfy reads multipart uploads sequentially: metadata must arrive before the file.
      let referenceAssetId: string | undefined;
      if (plan.prefixFrames || plan.suffixFrames) {
        if (!file) throw new HttpError(400, 'Upload the connected reference footage.');
        const body = new FormData(); body.set('content_type', 'video/mp4'); body.set('file_path', `sparko-${randomUUID()}.mp4`); body.set('file', file, 'reference.mp4');
        referenceAssetId = z.object({ id }).parse(await client.call('/api/v2/assets', { method: 'POST', body })).id;
      }
      const imageAssetIds: string[] = [];
      for (const image of images) {
        const body = new FormData(); body.set('content_type', 'image/jpeg'); body.set('file_path', `sparko-image-${randomUUID()}.jpg`); body.set('file', image, 'reference.jpg');
        imageAssetIds.push(z.object({ id }).parse(await client.call('/api/v2/assets', { method: 'POST', body })).id);
      }
      const workflow = bridgeWorkflow(referenceAssetId, input, randomInt(0, 2 ** 48 - 1), undefined, imageAssetIds);
      // Never automatically retry a paid submission after an ambiguous network error.
      const job = jobSchema.parse(await client.call('/api/v2/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
        // Partner credentials belong in per-job extra_data, never in the saved graph.
        body: JSON.stringify({ workflow, ...(input.resolution === '2k' ? {extra_data:{api_key_comfy_org:partnerKey}} : {}) }) }));
      return { requestId: job.id, status: 'IN_QUEUE', insertion: plan.insertion };
    },
    async cancel(requestId) {
      const path = `/api/v2/jobs/${encodeURIComponent(id.parse(requestId))}`;
      const job = jobSchema.parse(await client.call(path));
      if (!['succeeded', 'canceled', 'failed', 'expired'].includes(job.status)) await client.call(`${path}/cancel`, { method: 'POST' });
    },
    async assetUrl(assetId) {
      const asset = z.object({ url: z.url(), content_type: z.literal('video/mp4') }).parse(await client.call(`/api/v2/assets/${encodeURIComponent(id.parse(assetId))}`));
      const url = new URL(asset.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.origin === new URL(client.baseUrl).origin) throw new HttpError(502, 'Comfy did not return a signed media download URL.');
      return url.href;
    },
  };
}
