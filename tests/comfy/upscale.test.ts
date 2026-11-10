import { describe, expect, it, vi } from 'vitest';
import { createComfyProvider } from '../../server/features/comfy/provider';
import { upscaleWorkflow } from '../../server/features/comfy/workflow';
import { COMFY_MODELS } from '../../shared/constants';
import { comfyStage } from '../../shared/comfy-progress';

const input = { prompt: 'Bridge the scene', frames: 226 };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const regeneration = (model: string) => ({ input: { required: { model: ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: model, inputs: [] }] }] } } });
const catalogFor = (graph: ReturnType<typeof upscaleWorkflow>, model: string = COMFY_MODELS.regeneration): Record<string, object> =>
  ({ ...Object.fromEntries(Object.values(graph).map(node => [node.class_type, {}])), MinimaxHailuo03RegenerateNode: regeneration(model) });

describe('on-demand H3 2K upscale workflow', () => {
  it('regenerates the saved native render from its pixels, audio and exact prompt only', () => {
    const graph = upscaleWorkflow('native-asset', { ...input, prompt: 'Bridge\r\nthe scene' });
    expect(graph.source_video).toEqual({ class_type: 'VHS_LoadVideoFFmpeg', inputs: { video: { __type: 'core/ASSET', info: { id: 'native-asset' } }, force_rate: 24,
      custom_width: 0, custom_height: 0, frame_load_cap: 0, start_time: 0, format: 'None' } });
    expect(graph.base_video).toEqual({ class_type: 'CreateVideo', inputs: { images: ['source_video', 0], audio: ['source_video', 2], fps: 24 } });
    expect(graph.regenerate_2k).toEqual({ class_type: 'MinimaxHailuo03RegenerateNode', inputs: { video: ['base_video', 0], model: 'MiniMax H3', 'model.prompt': 'Bridge\nthe scene', 'model.resolution': '2K', watermark: false } });
    expect(graph.output).toEqual({ class_type: 'SaveVideo', inputs: { video: ['regenerate_2k', 0], filename_prefix: 'sparko/interstitial-2k', format: 'mp4', 'format.codec': 'auto' } });
    // No H3 model, text encoder, conditioning or latent is involved.
    expect(Object.values(graph).map(node => node.class_type).sort()).toEqual(['CreateVideo', 'MinimaxHailuo03RegenerateNode', 'SaveVideo', 'VHS_LoadVideoFFmpeg']);
  });
  it('restores exact-frame keyframes from the native render at the 2K size', () => {
    const graph = upscaleWorkflow('native-asset', { ...input, preservedFrames: [100, 40, 100] });
    expect(graph.preserved_native_0.inputs).toEqual({ image: ['source_video', 0], batch_index: 40, length: 1 });
    expect(graph.preserved_native_1.inputs).toEqual({ image: ['source_video', 0], batch_index: 100, length: 1 });
    expect(graph.preserved_native_2).toBeUndefined();
    expect(graph.preserved_2k_0.inputs).toMatchObject({ image: ['preserved_native_0', 0], width: ['regenerated_size', 0], height: ['regenerated_size', 1] });
    expect(graph.restore_2k_1_tail.inputs.image1).toEqual(['restore_2k_1_head', 0]);
    expect(graph.restore_2k_1_after.inputs).toEqual({ image: ['restore_2k_0_tail', 0], batch_index: 101, length: 125 });
    expect(graph.output.inputs.video).toEqual(['preserved_2k_video', 0]);
    expect(comfyStage('restore_2k_1_tail', 'ImageBatch')).toBe('Restoring exact frames');
  });
  it('enforces the official 107–362 frame range and valid preserved frames', () => {
    expect(() => upscaleWorkflow('a', { ...input, frames: 106 })).toThrow('4.46 seconds');
    expect(() => upscaleWorkflow('a', { ...input, frames: 107 })).not.toThrow();
    expect(() => upscaleWorkflow('a', { ...input, frames: 363 })).toThrow('362 frames');
    expect(() => upscaleWorkflow('a', { ...input, preservedFrames: [226] })).toThrow('inside the video');
    expect(() => upscaleWorkflow('a', { ...input, prompt: 'x'.repeat(7001) })).toThrow('7,000 characters');
  });
});

describe('Comfy on-demand 2K adapter', () => {
  it('uploads the native render and submits the partner job with per-job credentials', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(catalogFor(upscaleWorkflow('a', input))))
      .mockResolvedValueOnce(reply({ id: 'native-upload' })).mockResolvedValueOnce(reply({ id: 'comfy-2k-job', status: 'queued' }));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret' }, transport);
    expect(await provider.upscale(new Blob(['mp4']), input)).toEqual({ requestId: 'comfy-2k-job', status: 'IN_QUEUE' });
    expect(String(transport.mock.calls[1][0])).toMatch(/\/api\/v2\/assets$/);
    const payload = JSON.parse(String(transport.mock.calls[2][1]!.body));
    expect(payload.extra_data).toEqual({ api_key_comfy_org: 'secret' }); expect(JSON.stringify(payload.workflow)).not.toContain('secret');
    expect(payload.workflow.source_video.inputs.video.info.id).toBe('native-upload');
    expect(transport.mock.calls[2][1]!.headers).toMatchObject({ 'Idempotency-Key': expect.any(String) });
  });
  it('reports a missing partner node or model before uploading or paying', async () => {
    const graph = upscaleWorkflow('a', input), { MinimaxHailuo03RegenerateNode: _removed, ...withoutNode } = catalogFor(graph);
    const missingNode = vi.fn<typeof fetch>().mockImplementation(async () => reply(withoutNode));
    await expect(createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret' }, missingNode).upscale(new Blob(), input)).rejects.toThrow('MinimaxHailuo03RegenerateNode');
    expect(missingNode).toHaveBeenCalledTimes(1);
    const missingModel = vi.fn<typeof fetch>().mockImplementation(async () => reply(catalogFor(graph, 'Other model')));
    expect(await createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret' }, missingModel).checkUpscale()).toEqual({ ready: false, message: 'Comfy is missing model MiniMax H3.' });
    expect(await createComfyProvider({}, missingModel).checkUpscale()).toMatchObject({ ready: false, message: expect.stringContaining('COMFY_CLOUD_API_KEY') });
  });
  it('checks the frame-restoring nodes only when exact frames must be kept', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => reply(catalogFor(upscaleWorkflow('a', input))));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'secret' }, transport);
    expect(await provider.checkUpscale()).toEqual({ ready: true });
    expect(await provider.checkUpscale(true)).toMatchObject({ ready: false, message: expect.stringContaining('GetVideoComponents') });
  });
});
