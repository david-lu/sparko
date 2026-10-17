import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { GenerationJob } from '../../../shared/contracts.js';
import { COMFY_MODELS } from '../../../shared/constants.js';
import { comfyBridgePlan } from '../../../shared/comfy.js';
import { HttpError } from '../../shared/http.js';
import { ComfyClient } from './client.js';
import { bridgeWorkflow, type BridgeInput } from './workflow.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const jobSchema = z.object({ id, status: z.enum(['queued', 'running', 'succeeded', 'canceling', 'canceled', 'failed', 'expired']),
  queue_position: z.number().nullable().optional(), progress: z.object({ value: z.number().min(0).max(1) }).nullable().optional(),
  outputs: z.array(z.object({ id, node_id: z.string(), content_type: z.string() })).default([]),
  error: z.object({ message: z.string() }).nullable().optional(),
});
export type ComfyReadiness = { ready: boolean; message?: string };
export interface ComfyProvider {
  check(): Promise<ComfyReadiness>;
  submit(file: Blob, input: BridgeInput): Promise<GenerationJob>;
  status(requestId: string): Promise<GenerationJob>;
  cancel(requestId: string): Promise<void>;
  assetUrl(assetId: string): Promise<string>;
}

export function createComfyProvider(env: NodeJS.ProcessEnv, transport: typeof fetch = fetch): ComfyProvider {
  const client = new ComfyClient(env, transport);
  let checked: Promise<ComfyReadiness> | undefined, checkedAt = 0;
  const check = () => {
    if (!client.configured) return Promise.resolve({ ready: false, message: 'Add COMFY_CLOUD_API_KEY to .env and restart the server.' });
    if (checked && Date.now() - checkedAt < 60_000) return checked;
    checkedAt = Date.now();
    return checked = (async () => {
      const nodes = await client.call<Record<string, { input?: { required?: Record<string, unknown[]> } }>>('/api/object_info', { signal: AbortSignal.timeout(15_000) });
      const graph = bridgeWorkflow('preflight-asset', { before: 1.625, after: 1.625, duration: 6, prompt: 'Check', width: 960, height: 544, hasAudio: true }, 0);
      const missing = [...new Set(Object.values(graph).map(node => node.class_type))].filter(name => !nodes[name]);
      if (missing.length) return { ready: false, message: `Comfy is missing required nodes: ${missing.join(', ')}.` };
      for (const [node, field, model] of [['UNETLoader', 'unet_name', COMFY_MODELS.diffusion], ['CLIPLoader', 'clip_name', COMFY_MODELS.textEncoder], ['VAELoader', 'vae_name', COMFY_MODELS.videoVae], ['VAELoader', 'vae_name', COMFY_MODELS.audioVae]]) {
        const definition = nodes[node].input?.required?.[field];
        const options = Array.isArray(definition?.[0]) ? definition[0] as unknown[] : (definition?.[1] as { options?: unknown[] } | undefined)?.options;
        if (options && !options.includes(model)) return { ready: false, message: `Comfy is missing model ${model}.` };
      }
      return { ready: true };
    })().catch(error => ({ ready: false, message: client.message(error instanceof Error ? error.message : error) }));
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
    return { requestId, status: data.status === 'queued' ? 'IN_QUEUE' : 'IN_PROGRESS', queuePosition: data.queue_position ?? undefined, progress: data.progress?.value };
  };
  return {
    check, status,
    async submit(file, input) {
      const readiness = await check();
      if (!readiness.ready) throw new HttpError(503, readiness.message || 'Comfy is not ready.');
      const plan = comfyBridgePlan(input.before, input.after, input.duration);
      const body = new FormData(); body.set('file', file, 'reference.mp4'); body.set('content_type', 'video/mp4'); body.set('file_path', `sparko-${randomUUID()}.mp4`);
      const uploaded = z.object({ id }).parse(await client.call('/api/v2/assets', { method: 'POST', body }));
      const workflow = bridgeWorkflow(uploaded.id, input, randomInt(0, 2 ** 48 - 1));
      // Never automatically retry a paid submission after an ambiguous network error.
      const job = jobSchema.parse(await client.call('/api/v2/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ workflow }) }));
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
