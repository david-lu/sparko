import { describe, expect, it, vi } from 'vitest';
import { createComfyProvider } from '../../server/features/comfy/provider';
import { bridgeWorkflow } from '../../server/features/comfy/workflow';

const input = { before: 1.625, after: 1.625, duration: 6, prompt: 'Bridge the scene', width: 960, height: 544, hasAudio: true };
const catalogFor = (graph: ReturnType<typeof bridgeWorkflow>): Record<string, object> => ({ ...Object.fromEntries(Object.values(graph).map(node => [node.class_type, {}])), MVEx_FrameRangeMask: {} });
const catalog = catalogFor(bridgeWorkflow('input-asset', input, 0));
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const collect = async <T>(stream: AsyncIterable<T>) => { const items: T[] = []; for await (const item of stream) items.push(item); return items; };

describe('Comfy Cloud v2 adapter', () => {
  it('checks loop guides independently and fails before uploading when unavailable', async () => {
    const settings = { ...input, mode: 'loop' as const, before: 0, after: 0 };
    const nodes = { ...catalog, ...catalogFor(bridgeWorkflow(undefined, settings, 0, undefined, ['pose'])) };
    delete nodes.MiniMaxH3AddGuide;
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => reply(nodes));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret' }, transport);
    expect(await provider.check('standard', 'native', true)).toEqual({ ready: true });
    await expect(provider.submit(undefined, settings, [new Blob(['image'], { type: 'image/jpeg' })])).rejects.toThrow('MiniMaxH3AddGuide');
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.every(([url]) => String(url).endsWith('/api/object_info'))).toBe(true);
  });
  it('checks image-reference support separately and fails before uploads when the node is missing', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => reply(catalog));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret' }, transport);
    expect(await provider.check()).toEqual({ ready: true });
    await expect(provider.submit(new Blob(), input, [new Blob(['image'], { type: 'image/jpeg' })])).rejects.toThrow('MiniMaxH3ReferenceToVideo');
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.every(([url]) => String(url).endsWith('/api/object_info'))).toBe(true);
  });
  it('uploads ordered JPEG references and submits reference conditioning with 2K regeneration', async () => {
    const settings = { ...input, mode: 'custom' as const, before: 0, after: 0, resolution: '2k' as const };
    const nodes = { ...catalog, ...catalogFor(bridgeWorkflow(undefined, settings, 0, undefined, ['image-one', 'image-two'])) };
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(nodes)).mockResolvedValueOnce(reply({ id: 'image-one' }))
      .mockResolvedValueOnce(reply({ id: 'image-two' })).mockResolvedValueOnce(reply({ id: 'comfy-job-123', status: 'queued' }));
    const images = ['first', 'second'].map(text => new Blob([text], { type: 'image/jpeg' }));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret' }, transport);
    await provider.submit(undefined, settings, images);
    for (const [index, text] of ['first', 'second'].entries()) {
      const body = transport.mock.calls[index + 1][1]!.body as FormData;
      expect([...body.keys()]).toEqual(['content_type', 'file_path', 'file']);
      expect(body.get('content_type')).toBe('image/jpeg');
      expect(await (body.get('file') as Blob).text()).toBe(text);
    }
    const payload = JSON.parse(String(transport.mock.calls[3][1]!.body));
    expect(payload.workflow.reference_image_0.inputs.image.info.id).toBe('image-one');
    expect(payload.workflow.reference_image_1.inputs.image.info.id).toBe('image-two');
    expect(payload.workflow.conditioning.class_type).toBe('MiniMaxH3ReferenceToVideo');
    expect(payload.workflow.regenerate_2k.inputs['model.prompt']).toBe(input.prompt);
    expect(await provider.check('standard', '2k', true)).toEqual({ ready: true });
    expect(transport).toHaveBeenCalledTimes(4);
  });
  it('checks official 2K regeneration independently of native readiness before any upload or paid submission',async()=>{
    const transport=vi.fn<typeof fetch>().mockImplementation(async()=>reply(catalog)),provider=createComfyProvider({COMFY_CLOUD_API_KEY:'secret'},transport);
    expect(await provider.check()).toEqual({ready:true});
    await expect(provider.submit(new Blob(),{...input,resolution:'2k'})).rejects.toThrow('MinimaxHailuo03RegenerateNode');
    expect(await provider.check()).toEqual({ready:true});expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.every(([url])=>String(url).endsWith('/api/object_info'))).toBe(true);
  });
  it('requires the official MiniMax H3 API model and submits regeneration without a community upscaler',async()=>{
    const highCatalog=catalogFor(bridgeWorkflow('asset',{...input,resolution:'2k'},0));
    const missingModel={...highCatalog,MinimaxHailuo03RegenerateNode:{input:{required:{model:['COMFY_DYNAMICCOMBO_V3',{options:[{key:'Other model',inputs:[]}]}]}}}};
    const missingTransport=vi.fn<typeof fetch>().mockResolvedValue(reply(missingModel));
    await expect(createComfyProvider({COMFY_CLOUD_API_KEY:'secret'},missingTransport).submit(new Blob(),{...input,resolution:'2k'})).rejects.toThrow('MiniMax H3');expect(missingTransport).toHaveBeenCalledTimes(1);
    const available={...highCatalog,MinimaxHailuo03RegenerateNode:{input:{required:{model:['COMFY_DYNAMICCOMBO_V3',{options:[{key:'MiniMax H3',inputs:[]}]}]}}}};
    const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(reply(available)).mockResolvedValueOnce(reply({id:'input-asset'})).mockResolvedValueOnce(reply({id:'comfy-job-123',status:'queued'}));
    const provider=createComfyProvider({COMFY_CLOUD_API_KEY:'secret'},transport);await provider.submit(new Blob(),{...input,resolution:'2k'});
    const payload=JSON.parse(String(transport.mock.calls[2][1]!.body)),workflow=payload.workflow;
    expect(payload.extra_data).toEqual({api_key_comfy_org:'secret'});expect(JSON.stringify(workflow)).not.toContain('secret');
    expect(workflow.regenerate_2k.inputs).toMatchObject({model:'MiniMax H3','model.resolution':'2K','model.prompt':input.prompt});expect(workflow.output.inputs.video).toEqual(['regenerate_2k',0]);
    expect(await provider.check('standard','2k')).toEqual({ready:true});expect(transport).toHaveBeenCalledTimes(3);
  });
  it('skips asset uploads when neither reference is enabled', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(catalog)).mockResolvedValueOnce(reply({ id: 'comfy-job-123', status: 'queued' }));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret' }, transport);
    const job = await provider.submit(undefined, { ...input, mode: 'custom', before: 0, after: 0, hasAudio: false });
    expect(job.insertion?.start).toBe(0);
    expect(transport.mock.calls.map(([url]) => String(url))).toEqual(['https://cloud.comfy.org/api/object_info', 'https://cloud.comfy.org/api/v2/jobs']);
  });
  it('reports invalid optional Comfy configuration without breaking other providers at startup', async () => {
    const transport = vi.fn<typeof fetch>();
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret', COMFY_BASE_URL: 'invalid-url' }, transport);
    expect(await provider.check()).toMatchObject({ ready: false, message: 'COMFY_BASE_URL must be a valid HTTPS endpoint.' });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(['standard', 'uniform', 'vignette'] as const)('checks capabilities and submits native generation for saved %s masks', async maskInjection => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(catalog)).mockResolvedValueOnce(reply({ id: 'input-asset' }));
    transport.mockResolvedValueOnce(reply({ id: 'comfy-job-123', status: 'queued' }));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret-key' }, transport);
    const job = await provider.submit(new Blob(['video'], { type: 'video/mp4' }), { ...input, maskInjection });
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
    const submit = transport.mock.calls.at(-1)![1]!;
    expect(submit.headers).toMatchObject({ Authorization: 'Bearer secret-key', 'Idempotency-Key': expect.any(String) });
    const body = JSON.parse(String(submit.body));
    expect(body.workflow.before.inputs.video).toEqual({ __type: 'core/ASSET', info: { id: 'input-asset' } });
    expect(body.workflow.conditioning.inputs.prompt).toBe(input.prompt);
    expect(body.workflow.middle_strength).toBeUndefined();
    expect(body.workflow.vignette_image).toBeUndefined();
    expect(body.extra_data).toBeUndefined();
    expect(await provider.check(maskInjection)).toEqual({ ready: true });
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it('shares native readiness for retired masks without requiring FILM or vignette nodes', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => reply(catalog));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret' }, transport);
    expect(await provider.check()).toEqual({ ready: true });
    expect(await provider.check('uniform')).toEqual({ ready: true });
    expect(await provider.check('vignette')).toEqual({ ready: true });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('refuses missing nodes before uploading and reports the actual missing dependency', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(reply({}));
    await expect(createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret' }, transport).submit(new Blob(), input)).rejects.toThrow('MVEx_MaskToLatentSpace');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(['VHS_LoadVideoFFmpeg', 'GetAudioLatentSize', 'FeatherMask', 'CreateFadeMaskAdvanced'])('requires %s before uploading or submitting a job', async node => {
    const legacyCatalog: typeof catalog = { ...catalog, VHS_LoadVideo: {} };
    delete legacyCatalog[node];
    const transport = vi.fn<typeof fetch>().mockResolvedValue(reply(legacyCatalog));
    await expect(createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret' }, transport).submit(new Blob(), input)).rejects.toThrow(node);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0][0])).toBe('https://cloud.comfy.org/api/object_info');
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
      event('progress', { value: .9892857142857142, nodes_done: 27, nodes_total: 28 }) +
      event('progress', { value: .4, current_node: 'sample', step: 8, steps: 20, message: 'secret-key https://private.example/file' }) +
      event('preview', { data_base64: 'not-forwarded' }) + event('log', { message: 'secret-key' }) +
      event('progress', { value: .9, current_node: 'decode_video', step: null, steps: null }) +
      event('status', { status: 'succeeded', outputs: [{ url: 'https://signed.example/file' }] }),
      { headers: { 'Content-Type': 'text/event-stream' } }));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret-key' }, transport);
    const events = await collect(provider.events('comfy-job-123', new AbortController().signal));
    expect(events).toEqual([
      { type: 'status', status: 'IN_QUEUE', queuePosition: 2 },
      { type: 'progress', progress: .9892857142857142, progressDetails: { stage: 'Generating scene', nodesDone: 27, nodesTotal: 28 } },
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
