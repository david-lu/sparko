import { describe, expect, it, vi } from 'vitest';
import { createComfyProvider } from '../../server/features/comfy/provider';
import { bridgeWorkflow } from '../../server/features/comfy/workflow';

const input = { before: 1.625, after: 1.625, duration: 6, prompt: 'Bridge the scene', width: 960, height: 544, hasAudio: true };
const catalog = Object.fromEntries(Object.values(bridgeWorkflow('input-asset', input, 0)).map(node => [node.class_type, {}]));
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const collect = async <T>(stream: AsyncIterable<T>) => { const items: T[] = []; for await (const item of stream) items.push(item); return items; };

describe('Comfy Cloud v2 adapter', () => {
  it('reports invalid optional Comfy configuration without breaking other providers at startup', async () => {
    const transport = vi.fn<typeof fetch>();
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret', COMFY_BASE_URL: 'invalid-url' }, transport);
    expect(await provider.check()).toMatchObject({ ready: false, message: 'COMFY_BASE_URL must be a valid HTTPS endpoint.' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('checks capabilities, uploads a typed asset, and submits once with an idempotency key', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(catalog)).mockResolvedValueOnce(reply({ id: 'input-asset' })).mockResolvedValueOnce(reply({ id: 'comfy-job-123', status: 'queued' }));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret-key' }, transport);
    const job = await provider.submit(new Blob(['video'], { type: 'video/mp4' }), input);
    expect(job).toMatchObject({ requestId: 'comfy-job-123', insertion: { start: 1.625, duration: 148 / 24 }, status: 'IN_QUEUE' });
    expect(transport.mock.calls.map(([url]) => String(url))).toEqual(['https://cloud.comfy.org/api/object_info', 'https://cloud.comfy.org/api/v2/assets', 'https://cloud.comfy.org/api/v2/jobs']);
    const upload = transport.mock.calls[1][1]!.body as FormData;
    expect(upload.get('content_type')).toBe('video/mp4');
    expect(upload.get('file')).toBeInstanceOf(Blob);
    // Comfy streams the file as it arrives, so metadata must precede its bytes.
    const multipart = await new Request('https://cloud.comfy.org/api/v2/assets', { method: 'POST', body: upload }).text();
    const fileOffset = multipart.indexOf('name="file";');
    expect(multipart.indexOf('name="content_type"')).toBeLessThan(fileOffset);
    expect(multipart.indexOf('name="file_path"')).toBeLessThan(fileOffset);
    const submit = transport.mock.calls[2][1]!;
    expect(submit.headers).toMatchObject({ Authorization: 'Bearer secret-key', 'Idempotency-Key': expect.any(String) });
    const body = JSON.parse(String(submit.body));
    expect(body.workflow.before.inputs.video).toEqual({ __type: 'core/ASSET', info: { id: 'input-asset' } });
    expect(body.workflow.conditioning.inputs.prompt).toBe(input.prompt);
    expect(body.extra_data).toBeUndefined();
    expect(await provider.check()).toEqual({ ready: true });
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it('refuses missing nodes before uploading and reports the actual missing dependency', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(reply({}));
    await expect(createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret' }, transport).submit(new Blob(), input)).rejects.toThrow('MVEx_MaskToLatentSpace');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('returns step progress, a durable authenticated media route, and refreshed signed URLs', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ id: 'comfy-job-123', status: 'running', progress: { value: .4, current_node: 'sample', step: 8, steps: 20, nodes_done: 12, nodes_total: 30 } }))
      .mockResolvedValueOnce(reply({ id: 'comfy-job-123', status: 'succeeded', outputs: [{ id: 'output-asset', node_id: 'output', content_type: 'video/mp4' }] }))
      .mockResolvedValueOnce(reply({ url: 'https://storage.example/video.mp4?signature=fresh', content_type: 'video/mp4' }));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret' }, transport);
    expect(await provider.status('comfy-job-123')).toEqual({ requestId: 'comfy-job-123', status: 'IN_PROGRESS', progress: .4, queuePosition: undefined,
      progressDetails: { stage: 'Generating video and audio', step: 8, steps: 20, nodesDone: 12, nodesTotal: 30 } });
    expect(await provider.status('comfy-job-123')).toEqual({ requestId: 'comfy-job-123', status: 'COMPLETED', videoUrl: '/api/comfy/assets/output-asset/content' });
    expect(await provider.assetUrl('output-asset')).toContain('signature=fresh');
  });
  it('sanitizes execution errors and never retries paid submissions automatically', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(catalog)).mockResolvedValueOnce(reply({ id: 'input-asset' })).mockResolvedValueOnce(reply({ error: { message: 'Invalid graph secret-key Bearer hidden https://private.example/video' } }, 422));
    await expect(createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret-key' }, transport).submit(new Blob(), input)).rejects.toThrow('Invalid graph [redacted] [redacted] [URL]');
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it('streams only normalized stages and steps, then reconciles terminal status through the job endpoint', async () => {
    const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      event('status', { status: 'queued', queue_position: 2 }) +
      event('progress', { value: .4, current_node: 'sample', step: 8, steps: 20, message: 'secret-key https://private.example/file' }) +
      event('preview', { data_base64: 'not-forwarded' }) + event('log', { message: 'secret-key' }) +
      event('progress', { value: .9, current_node: 'decode_video', step: null, steps: null }) +
      event('status', { status: 'succeeded', outputs: [{ url: 'https://signed.example/file' }] }),
      { headers: { 'Content-Type': 'text/event-stream' } }));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret-key' }, transport);
    const events = await collect(provider.events('comfy-job-123', new AbortController().signal));
    expect(events).toEqual([
      { type: 'status', status: 'IN_QUEUE', queuePosition: 2 },
      { type: 'progress', progress: .4, progressDetails: { stage: 'Generating video and audio', step: 8, steps: 20 } },
      { type: 'progress', progress: .9, progressDetails: { stage: 'Decoding video' } },
      { type: 'refresh' },
    ]);
    expect(transport.mock.calls[0][0]).toBe('https://cloud.comfy.org/api/v2/jobs/comfy-job-123/events');
    expect(transport.mock.calls[0][1]?.headers).toMatchObject({ Accept: 'text/event-stream', Authorization: 'Bearer secret-key' });
  });
  it('does not mistake a stream error or a truncated catalog for a completed job', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('event: error\ndata: {"error":{"message":"secret-key"}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
      .mockResolvedValueOnce(new Response('{'));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret-key' }, transport);
    await expect(collect(provider.events('comfy-job-123', new AbortController().signal))).rejects.toThrow('Comfy progress stream disconnected.');
    expect(await provider.check()).toMatchObject({ ready: false });
    expect((await provider.check()).message).not.toContain('missing required nodes');
  });
  it('cancels only the requested active job and leaves completed renders intact', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ id: 'comfy-job-123', status: 'running' })).mockResolvedValueOnce(reply({}))
      .mockResolvedValueOnce(reply({ id: 'finished-123', status: 'succeeded' }));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret' }, transport);
    await provider.cancel('comfy-job-123'); await provider.cancel('finished-123');
    expect(transport.mock.calls[1][0]).toBe('https://cloud.comfy.org/api/v2/jobs/comfy-job-123/cancel');
    expect(transport.mock.calls[1][1]?.method).toBe('POST');
    expect(transport).toHaveBeenCalledTimes(3);
  });
});
