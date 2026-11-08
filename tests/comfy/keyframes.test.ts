import { describe, expect, it, vi } from 'vitest';
import { bridgeWorkflow } from '../../server/features/comfy/workflow';
import { createComfyProvider } from '../../server/features/comfy/provider';
import { comfyBridgePlan } from '../../shared/comfy';
import { validateVideoKeyframes, validateVideoKeyframeInputs, videoKeyframesSchema } from '../../shared/video-keyframes';

const input = { before: 1.625, after: 1.625, duration: 6, prompt: 'Lift a rock, then a sock.', width: 960, height: 544, hasAudio: true };
const keyframes = [{ frame: 90, imageIndex: 0 }, { frame: 24, imageIndex: 1 }];
const plan = comfyBridgePlan(input.before, input.after, input.duration);
const jpeg = () => new Blob(['image'], { type: 'image/jpeg' });
const reply = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

describe('timed H3 image guides', () => {
  it.each([0, 1.625, 2.3333333333333335])('adds prefix %s exactly once without changing the masks, audio or duration', before => {
    const settings = { ...input, mode: 'custom' as const, before };
    const base = bridgeWorkflow('video', settings, 123);
    const graph = bridgeWorkflow('video', { ...settings, keyframes }, 123, undefined, [], ['sock', 'rock']);
    expect(graph.conditioning).toEqual(base.conditioning);
    expect(graph.keyframe_image_0.inputs.image).toMatchObject({ info: { id: 'rock' } });
    expect(graph.keyframe_guide_0.inputs).toMatchObject({ frame_idx: Math.round(before * 24) + 24, positive: ['conditioning', 0], image: ['keyframe_image_0', 0] });
    expect(graph.keyframe_guide_1.inputs).toMatchObject({ frame_idx: Math.round(before * 24) + 90, positive: ['keyframe_guide_0', 0] });
    expect(graph.guider.inputs.conditioning).toEqual(['keyframe_guide_1', 0]);
    for (const node of ['middle_mask', 'freeze_video', 'freeze_audio', 'sample', 'encode_audio', 'gap_audio']) expect(graph[node]).toEqual(base[node]);
  });
  it('supports image-only generation with independent endpoint and interior guides', () => {
    const graph = bridgeWorkflow(undefined, { ...input, mode: 'custom', before: 0, after: 0, startImageIndex: 0, endImageIndex: 1, keyframes }, 1, undefined, ['start', 'end'], ['sock', 'rock']);
    expect(graph.conditioning.inputs).toHaveProperty('ref_images.ref_image_1');
    expect(graph.conditioning.inputs).not.toHaveProperty('ref_images.ref_image_2');
    expect(graph.keyframe_guide_0.inputs.positive).toEqual(['guide_end', 0]);
    expect(graph.keyframe_guide_0.inputs.frame_idx).toBe(24);
    expect(graph.encode_audio).toBeUndefined();
  });
  it.each([
    [[{ frame: 24, imageIndex: 0 }, { frame: 24, imageIndex: 1 }], 'same frame'],
    [[{ frame: plan.middleFrames, imageIndex: 0 }], 'outside'],
    [[{ frame: 24, imageIndex: 2 }], 'Choose an image'],
    [[{ frame: -1, imageIndex: 0 }], ''],
    [[{ frame: 1.5, imageIndex: 0 }], ''],
  ] as const)('rejects invalid positions %j', (values, message) => {
    expect(() => validateVideoKeyframeInputs([...values], plan.middleFrames, 2)).toThrow(message);
  });
  it('rejects endpoint conflicts and allows disabled unfinished keyframes', () => {
    expect(() => validateVideoKeyframeInputs([{ frame: 0, imageIndex: 0 }], 100, 1, true)).toThrow('overlaps');
    expect(() => validateVideoKeyframeInputs([{ frame: 99, imageIndex: 0 }], 100, 1, false, true)).toThrow('overlaps');
    expect(() => validateVideoKeyframes([{ id: 'empty', enabled: false, frame: 300 }], 100)).not.toThrow();
    expect(() => validateVideoKeyframes([{ id: 'empty', enabled: true, frame: 30 }], 100)).toThrow('Choose an image');
    expect(() => videoKeyframesSchema.parse(Array(2).fill({ id: 'duplicate', enabled: false, frame: 0 }))).toThrow('unique');
  });
  it('uploads timed images separately and validates before any network or paid submission', async () => {
    const settings = { ...input, keyframes };
    const referenceGraph = bridgeWorkflow('video', input, 0, undefined, ['reference']);
    const catalog = { ...Object.fromEntries(Object.values(referenceGraph).map(node => [node.class_type, {}])), MiniMaxH3AddGuide: {}, MVEx_FrameRangeMask: {} };
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(catalog))
      .mockResolvedValueOnce(reply({ id: 'video-asset' })).mockResolvedValueOnce(reply({ id: 'reference-image' }))
      .mockResolvedValueOnce(reply({ id: 'sock-image' })).mockResolvedValueOnce(reply({ id: 'rock-image' }))
      .mockResolvedValueOnce(reply({ id: 'keyframe-job', status: 'queued' }));
    const provider = createComfyProvider({ COMFY_CLOUD_API_KEY: 'test' }, transport);
    await expect(provider.submit(new Blob(['video']), settings, [jpeg()], [jpeg()])).rejects.toThrow('Choose an image');
    expect(transport).not.toHaveBeenCalled();
    await provider.submit(new Blob(['video']), settings, [jpeg()], [jpeg(), jpeg()]);
    const graph = JSON.parse(String(transport.mock.calls.at(-1)![1]!.body)).workflow;
    expect(graph.reference_image_0.inputs.image.info.id).toBe('reference-image');
    expect(graph.keyframe_image_0.inputs.image.info.id).toBe('rock-image');
    expect(graph.keyframe_image_1.inputs.image.info.id).toBe('sock-image');
    expect(graph.keyframe_guide_0.inputs.frame_idx).toBe(63);
    expect(transport).toHaveBeenCalledTimes(6);
  });
});
