import { describe, expect, it, vi } from 'vitest';
import { createComfyProvider } from '../../server/features/comfy/provider';
import { bridgeWorkflow } from '../../server/features/comfy/workflow';

const filename = 'iris-animation__h3_character.safetensors';
const settings = { before: 0, after: 0, duration: 6, prompt: 'A scene', width: 960, height: 544, hasAudio: false, mode: 'custom' as const };
const catalog = { ...Object.fromEntries(Object.values(bridgeWorkflow('preflight-asset', { ...settings, before: 1.625, after: 1.625, mode: 'bridge', hasAudio: true }, 0)).map(node => [node.class_type, {}])),
  MVEx_FrameRangeMask: {}, LoraLoaderModelOnly: { input: { required: { lora_name: [[filename]] } } } };

describe('Comfy LoRA execution', () => {
  it('loads the selected LoRA before shifting, scheduling and sampling H3', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async url => Response.json(String(url).endsWith('/api/object_info') ? catalog : { id: 'comfy-job-123', status: 'queued' }));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'test' }, transport);
    await provider.submit(undefined, { ...settings, lora: filename });
    const body = JSON.parse(String(transport.mock.calls.at(-1)![1]!.body));
    expect(body.workflow.lora).toEqual({ class_type: 'LoraLoaderModelOnly', inputs: { model: ['model', 0], lora_name: filename, strength_model: 1 } });
    expect(body.workflow.shift.inputs.model).toEqual(['lora', 0]);
    expect(body.workflow.guider.inputs.model).toEqual(['shift', 0]);
    expect(body.workflow.schedule.inputs.model).toEqual(['shift', 0]);
    const plain = bridgeWorkflow(undefined, settings, 0); expect(plain.lora).toBeUndefined(); expect(plain.shift.inputs.model).toEqual(['model', 0]);
  });

  it.each([0, 0.65, 1.4, -0.5])('passes strength %s to the submitted H3 workflow', async loraStrength => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async url => Response.json(String(url).endsWith('/api/object_info') ? catalog : { id: 'comfy-job-123', status: 'queued' }));
    await createComfyProvider({ COMFY_CLOUD_API_KEY: 'test' }, transport).submit(undefined, { ...settings, lora: filename, loraStrength });
    const body = JSON.parse(String(transport.mock.calls.at(-1)![1]!.body));
    expect(body.workflow.lora.inputs.strength_model).toBe(loraStrength);
  });

  it.each([-101, 101, NaN, Infinity])('rejects invalid strength %s before submission', async loraStrength => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(catalog));
    await expect(createComfyProvider({ COMFY_CLOUD_API_KEY: 'test' }, transport).submit(undefined, { ...settings, lora: filename, loraStrength })).rejects.toThrow();
    expect(transport.mock.calls.every(([url]) => String(url).endsWith('/api/object_info'))).toBe(true);
  });

  it('resolves authenticated Comfy asset metadata to an imported filename', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async url => Response.json(String(url).includes('/api/assets/')
      ? { name: 'blake3:hash', tags: ['models', 'loras'], metadata: { filename } } : catalog));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'test' }, transport);
    expect(await provider.resolveLora('https://cloud.comfy.org/api/assets/model-123/content')).toBe(filename);
    expect(transport.mock.calls.map(([url]) => url)).toEqual(['https://cloud.comfy.org/api/assets/model-123', 'https://cloud.comfy.org/api/object_info']);
    expect(transport.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer test' });
  });

  it('rejects unavailable models and unsafe links before any asset upload or paid submission', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async url => Response.json(String(url).includes('/api/assets?') ? { assets: [], has_more: false } : catalog));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'test' }, transport);
    await expect(provider.submit(undefined, { ...settings, lora: 'missing.safetensors' })).rejects.toThrow('not available');
    expect(transport).toHaveBeenCalledTimes(2);
    await expect(provider.resolveLora('https://evil.test/api/assets/model-123')).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(2);
    const wrong = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: filename, tags: ['models', 'checkpoints'] }));
    await expect(createComfyProvider({ COMFY_CLOUD_API_KEY: 'test' }, wrong).resolveLora('https://cloud.comfy.org/api/assets/model-123')).rejects.toThrow('not a LoRA');
    expect(wrong).toHaveBeenCalledTimes(1);
  });

  it('finds private imported LoRAs across pages even when they are absent from the built-in catalog', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (String(url).endsWith('/api/object_info')) return Response.json(catalog);
      return Response.json(String(url).endsWith('offset=0') ? { assets: [{ name: 'unrelated.safetensors', tags: ['models', 'loras'] }], has_more: true }
        : { assets: [{ name: 'iris-animation__private.safetensors', tags: ['models', 'model_type:loras'], metadata: { filename: 'private.safetensors' } }], has_more: false });
    });
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'test' }, transport);
    expect(await provider.resolveLora('private.safetensors')).toBe('iris-animation__private.safetensors');
    expect(transport.mock.calls.map(([url]) => String(url))).toEqual(['https://cloud.comfy.org/api/object_info',
      'https://cloud.comfy.org/api/assets?include_tags=models&include_public=false&limit=100&offset=0',
      'https://cloud.comfy.org/api/assets?include_tags=models&include_public=false&limit=100&offset=1']);
  });

  it('rejects ambiguous short filenames and excludes missing model assets', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async url => Response.json(String(url).endsWith('/api/object_info') ? catalog : {
      assets: ['first__private.safetensors', 'second__private.safetensors'].map(name => ({ name, tags: ['models', 'loras'] })), has_more: false,
    }));
    await expect(createComfyProvider({ COMFY_CLOUD_API_KEY: 'test' }, transport).resolveLora('private.safetensors')).rejects.toThrow('More than one');
    const missing = vi.fn<typeof fetch>().mockImplementation(async url => Response.json(String(url).endsWith('/api/object_info') ? catalog : {
      assets: [{ name: 'private.safetensors', tags: ['models', 'loras', 'missing'] }], has_more: false,
    }));
    await expect(createComfyProvider({ COMFY_CLOUD_API_KEY: 'test' }, missing).resolveLora('private.safetensors')).rejects.toThrow('not available');
  });
});
