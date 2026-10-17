import { describe, expect, it } from 'vitest';
import { comfyBridgePlan, comfyDimensions, comfyReferenceRange } from '../../shared/comfy';
import { bridgeWorkflow } from '../../server/features/comfy/workflow';

describe('H3 two-sided temporal bridge', () => {
  it('snaps the generated target and protected contexts to H3’s grid', () => {
    const plan = comfyBridgePlan(2, 2, 6);
    expect(plan).toEqual({ prefixFrames: 39, suffixFrames: 39, middleFrames: 148, totalFrames: 226,
      insertion: { start: 39 / 24, duration: 148 / 24, totalDuration: 226 / 24 } });
    const range = comfyReferenceRange({ time: 10, start_range: 2, end_range: 3, duration: 6 }, 20);
    expect(range.start + range.insertAt).toBe(10);
    expect(range.end - range.after).toBe(10);
    expect(range.plan.suffixFrames).toBe(56);
    expect((range.plan.totalFrames - 5) % 17).toBe(0);
    expect(range.plan.insertion.duration).toBeGreaterThanOrEqual(6);
  });
  it('rejects missing context and oversized targets before an upload or paid job', () => {
    for (const time of [0, 1, 19, 20]) expect(() => comfyReferenceRange({ time, start_range: 2, end_range: 2, duration: 6 }, 20)).toThrow('1.625');
    expect(() => comfyBridgePlan(4, 4, 13)).toThrow('362 frames');
    expect(() => comfyBridgePlan(NaN, 2, 6)).toThrow();
    expect(comfyDimensions(2544, 1456)).toEqual({ width: 960, height: 544 });
    expect(comfyDimensions(720, 1280)).toEqual({ width: 544, height: 960 });
  });
  it('conditions on both motion windows and masks only the missing middle', () => {
    const graph = bridgeWorkflow('uploaded-asset', { before: 1.625, after: 1.625, duration: 6, width: 960, height: 544, prompt: 'Continue moving', hasAudio: true }, 123);
    expect(graph.before.inputs).toMatchObject({ video: { __type: 'core/ASSET', info: { id: 'uploaded-asset' } }, skip_first_frames: 0, frame_load_cap: 39 });
    expect(graph.after.inputs).toMatchObject({ skip_first_frames: 39, frame_load_cap: 39 });
    expect(graph.place_before.inputs).toMatchObject({ source: ['encode_before', 0], index: 0 });
    expect(graph.place_after.inputs).toMatchObject({ source: ['encode_after', 0], index: -12 });
    expect(graph.middle_mask.inputs).toMatchObject({ frames: 226, ranges: '39:187' });
    expect(graph.freeze_video.inputs).toEqual({ samples: ['place_after', 0], mask: ['latent_mask', 0] });
    expect(graph.freeze_audio.inputs).toMatchObject({ start_time: 39 / 24, end_time: 187 / 24 });
    expect(graph.sample.inputs.latent_image).toEqual(['freeze_audio', 0]);
    expect(graph.conditioning.inputs.prompt).toBe('Continue moving');
    expect(graph.output.inputs).toMatchObject({ frame_rate: 24, format: 'video/h264-mp4', trim_to_audio: false });
    expect(Object.values(graph).some(node => /MaskedAVBridge/.test(node.class_type))).toBe(false);
  });
  it('generates audio when the source is silent without connecting missing source audio', () => {
    const graph = bridgeWorkflow('uploaded-asset', { before: 1.625, after: 1.625, duration: 6, width: 960, height: 544, prompt: 'Continue', hasAudio: false }, 123);
    expect(graph.encode_audio).toBeUndefined();
    expect(graph.sample.inputs.latent_image).toEqual(['joint', 0]);
    expect(graph.joint.inputs.audio_latent).toEqual(['empty_streams', 1]);
    expect(graph.decode_audio).toBeDefined();
  });
});
