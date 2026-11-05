import { describe, expect, it, vi } from 'vitest';
import { COMFY, COMFY_MODELS } from '../../shared/constants';
import { createComfyProvider } from '../../server/features/comfy/provider';
import { bridgeWorkflow } from '../../server/features/comfy/workflow';

const input = { before: 0, after: 0, mode: 'custom' as const, duration: 6, prompt: 'Sema waves', width: 960, height: 544, hasAudio: false };
const character = 'sema.safetensors';
const catalog = { ...Object.fromEntries(Object.values(bridgeWorkflow('video', { ...input, before: 1.625, after: 1.625, hasAudio: true }, 0)).map(node => [node.class_type, {}])),
  MVEx_FrameRangeMask: {}, LoraLoaderModelOnly: { input: { required: { lora_name: [[character, COMFY_MODELS.turboLora]] } } } };

describe('H3 Turbo', () => {
  it.each(['bridge', 'extend', 'loop', 'custom'] as const)('uses the Ref2VA Turbo recipe and preserves %s conditioning, masks and output', mode => {
    const settings = { ...input, mode, before: mode === 'custom' ? 0 : 1.625, after: mode === 'bridge' || mode === 'loop' ? 1.625 : 0, hasAudio: true };
    for (const lora of [null, character]) for (const images of [[], ['image']]) {
      const plain = bridgeWorkflow('video', { ...settings, lora, loraStrength: 0.65 }, 42, undefined, images);
      const graph = bridgeWorkflow('video', { ...settings, lora, loraStrength: 0.65, turbo: true }, 42, undefined, images);
      expect(graph.turbo_lora).toEqual({ class_type: 'LoraLoaderModelOnly', inputs: { model: ['model', 0], lora_name: COMFY_MODELS.turboLora, strength_model: 1 } });
      if (lora) expect(graph.lora.inputs).toEqual({ model: ['turbo_lora', 0], lora_name: lora, strength_model: 0.65 });
      else expect(graph.lora).toBeUndefined();
      expect(graph.shift.inputs).toEqual({ model: [lora ? 'lora' : 'turbo_lora', 0], shift_video: 12, shift_audio: 3 });
      expect(graph.sampler.inputs.sampler_name).toBe('euler');
      expect(graph.schedule.inputs).toEqual({ model: ['shift', 0], scheduler: 'simple', steps: 4, denoise: 1 });
      for (const node of ['model', 'conditioning', 'before', 'after', 'middle_mask', 'freeze_video', 'freeze_audio', 'sample', 'output']) expect(graph[node]).toEqual(plain[node]);
      expect(plain.turbo_lora).toBeUndefined(); expect(plain.schedule.inputs.steps).toBe(COMFY.steps); expect(plain.sampler.inputs.sampler_name).toBe(COMFY.sampler);
      expect(bridgeWorkflow('video', { ...settings, lora, loraStrength: 0.65, turbo: false }, 42, undefined, images)).toEqual(plain);
    }
  });

  it.each([null, character])('submits Turbo with optional character LoRA %s', async lora => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async url => Response.json(String(url).endsWith('/api/object_info') ? catalog : { id: 'turbo-job-123', status: 'queued' }));
    await createComfyProvider({ COMFY_CLOUD_API_KEY: 'test' }, transport).submit(undefined, { ...input, turbo: true, lora, loraStrength: 0 });
    const { workflow } = JSON.parse(String(transport.mock.calls.at(-1)![1]!.body));
    expect(workflow.schedule.inputs.steps).toBe(4); expect(workflow.turbo_lora.inputs.strength_model).toBe(1);
    if (lora) expect(workflow.lora.inputs.strength_model).toBe(0);
  });

  it('checks Turbo independently of cached normal readiness and fails before uploading or submitting when missing', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ...catalog, LoraLoaderModelOnly: { input: { required: { lora_name: [[character]] } } } }));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'test' }, transport);
    expect(await provider.check()).toEqual({ ready: true });
    await expect(provider.submit(new Blob(['video']), { ...input, before: 1.625, turbo: true })).rejects.toThrow('missing the H3 Turbo LoRA');
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.every(([url]) => String(url).endsWith('/api/object_info'))).toBe(true);
    expect(await provider.check()).toEqual({ ready: true });
  });
});
