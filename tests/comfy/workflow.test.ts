import { describe, expect, it } from 'vitest';
import { comfyBridgePlan, comfyDimensions, comfyReferenceRange } from '../../shared/comfy';
import { bridgeWorkflow } from '../../server/features/comfy/workflow';

describe('H3 two-sided temporal bridge', () => {
  it.each([[true, true], [true, false], [false, true], [false, false]])('omits disabled reference loaders and masks (input %s, output %s)', (before, after) => {
    const input = { mode: 'custom' as const, before: before ? 1.625 : 0, after: after ? 1.625 : 0, duration: 6, width: 960, height: 544, prompt: 'A new scene', hasAudio: true };
    const plan = comfyBridgePlan(input.before, input.after, 6, 'custom');
    const graph = bridgeWorkflow(before || after ? 'asset' : undefined, input, 123);
    expect(!!graph.before).toBe(before); expect(!!graph.place_before).toBe(before);
    expect(!!graph.after).toBe(after); expect(!!graph.place_after).toBe(after);
    expect(!!graph.freeze_audio).toBe(before || after);
    expect(graph.middle_mask.inputs.ranges).toBe(`${plan.prefixFrames}:${plan.totalFrames - plan.suffixFrames}`);
    if (after) expect(graph.after.inputs.skip_first_frames).toBe(plan.prefixFrames);
    if (!before && after) expect(graph.audio_full.inputs.audio1).toEqual(['gap_audio', 0]);
    if (!before && !after) expect(graph.freeze_video.inputs.samples).toEqual(['empty_streams', 0]);
    // Every node link points at an existing node, including either one-sided path.
    for (const node of Object.values(graph)) for (const value of Object.values(node.inputs)) {
      if (Array.isArray(value) && typeof value[0] === 'string') expect(graph[value[0]]).toBeDefined();
    }
  });
  it.each(['bridge', 'loop'] as const)('applies the vignette only inside the generated %s section', mode => {
    const input = { mode, before: 1.625, after: 1.625, duration: 7, width: 960, height: 544, prompt: 'Exact prompt', hasAudio: true, maskInjection: 'vignette' as const };
    expect(() => bridgeWorkflow('asset', input, 123)).toThrow('uploaded gradient');
    const graph = bridgeWorkflow('asset', input, 123, 'mask-asset');
    expect(graph.vignette_image.inputs.image).toEqual({ __type: 'core/ASSET', info: { id: 'mask-asset' } });
    expect(graph.vignette_amplitude.inputs.value).toBe(.05); expect(graph.vignette_floor.inputs.value).toBe(.95);
    expect(graph.vignette_scaled.inputs).toMatchObject({ destination: ['vignette_gradient', 0], source: ['vignette_amplitude', 0], operation: 'multiply' });
    expect(graph.vignette_mask.inputs).toMatchObject({ destination: ['vignette_scaled', 0], source: ['vignette_floor', 0], operation: 'add' });
    expect(graph.middle_mask.inputs).toEqual({ width: 960, height: 544, frames: 260, ranges: '39:221' });
    expect(graph.scale_middle_mask.inputs).toMatchObject({ destination: ['middle_mask', 0], source: ['vignette_mask', 0], operation: 'multiply' });
    expect(graph.latent_mask.inputs).toMatchObject({ masks: ['scale_middle_mask', 0], spatial_method: 'max', temporal_method: 'max', grow_spatial: 0, grow_temporal: 0 });
    expect(graph.freeze_video.inputs.mask).toEqual(['latent_mask', 0]);
    expect(graph.encode_target.inputs.pixels).toEqual(['interpolated_target', 0]);
    expect(graph.freeze_audio.inputs.start_time).toBe(39 / 24);
    expect(graph.freeze_audio.inputs.end_time).toBeCloseTo(221 / 24, 10);
    expect(graph.conditioning.inputs.prompt).toBe('Exact prompt');
  });
  it('extends a Call using only frozen preceding footage and generates the entire tail', () => {
    const range = comfyReferenceRange({ method: 'comfy-extend', time: 2, start_range: 2, end_range: 2, duration: 6 }, 2);
    expect(range.mode).toBe('extend'); expect(range.after).toBe(0);
    expect(range.plan.insertion.start + range.plan.insertion.duration).toBe(range.plan.insertion.totalDuration);
    const graph = bridgeWorkflow('asset', { mode: 'extend', before: 1.625, after: 0, duration: 6, width: 960, height: 544, prompt: 'Ask', hasAudio: true }, 1);
    expect(graph.after).toBeUndefined(); expect(graph.place_after).toBeUndefined();
    expect(graph.interpolate_middle).toBeUndefined(); expect(graph.middle_strength).toBeUndefined();
    expect(graph.place_before.inputs.destination).toEqual(['empty_streams', 0]);
    expect(graph.latent_mask.inputs.masks).toEqual(['middle_mask', 0]);
    expect(graph.freeze_video.inputs.samples).toEqual(['place_before', 0]);
    expect(graph.encode_audio.inputs.audio).toEqual(['audio_prefix', 0]);
    expect(graph.middle_mask.inputs.ranges).toBe(`39:${range.plan.totalFrames}`);
  });
  it('accepts a short Idle loop with two protected context windows', () => {
    const plan = comfyBridgePlan(2, 2, 2, 'loop');
    expect(plan.insertion.duration).toBeGreaterThanOrEqual(2);
    expect(plan.insertion.duration).toBeLessThan(3);
    expect(plan.prefixFrames).toBe(plan.suffixFrames);
    expect(() => comfyBridgePlan(2, 2, 2, 'bridge')).toThrow('5');
    expect(() => comfyBridgePlan(2, 1, 6, 'extend')).toThrow();
  });
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
    expect(comfyDimensions(2544, 1456)).toEqual({ width: 1344, height: 768 });
    expect(comfyDimensions(720, 1280)).toEqual({ width: 736, height: 1280 });
    expect(comfyDimensions(2000, 2000)).toEqual({ width: 768, height: 768 });
  });
  it('conditions on both motion windows and masks only the missing middle', () => {
    const graph = bridgeWorkflow('uploaded-asset', { before: 1.625, after: 1.625, duration: 6, width: 960, height: 544, prompt: 'Continue moving', hasAudio: true }, 123);
    expect(graph.before.inputs).toMatchObject({ video: { __type: 'core/ASSET', info: { id: 'uploaded-asset' } }, skip_first_frames: 0, frame_load_cap: 39 });
    expect(graph.after.inputs).toMatchObject({ skip_first_frames: 39, frame_load_cap: 39 });
    expect(graph.place_before.inputs).toMatchObject({ source: ['encode_before', 0], index: 0 });
    expect(graph.place_after.inputs).toMatchObject({ source: ['encode_after', 0], index: -12 });
    expect(graph.end_guide).toBeUndefined();
    expect(graph.interpolate_middle).toBeUndefined();
    expect(graph.middle_strength).toBeUndefined();
    expect(graph.place_before.inputs.destination).toEqual(['empty_streams', 0]);
    expect(graph.latent_mask.inputs.masks).toEqual(['middle_mask', 0]);
    expect(graph.guider.inputs.conditioning).toEqual(['conditioning', 0]);
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
  it.each(['bridge', 'loop'] as const)('seeds %s with motion interpolation at 0.97 while keeping the references and audio masks independent', mode => {
    const plan = comfyBridgePlan(2, 3, 6, mode);
    const graph = bridgeWorkflow('asset', { mode, before: 2, after: 3, duration: 6, width: 960, height: 544, prompt: 'Exact prompt', hasAudio: true, interpolateMiddle: true }, 123);
    expect(graph.last_before.inputs).toEqual({ image: ['before', 0], batch_index: plan.prefixFrames - 1, length: 1 });
    expect(graph.first_after.inputs).toEqual({ image: ['after', 0], batch_index: 0, length: 1 });
    expect(graph.boundary_frames.inputs).toEqual({ image1: ['last_before', 0], image2: ['first_after', 0] });
    expect(graph.interpolation_model.inputs.model_name).toBe('film_net_fp16.safetensors');
    expect(Object.values(graph).some(node => node.class_type === 'TransitionImagesMulti')).toBe(false);
    expect(graph.target_prefix.inputs).toEqual({ image1: ['before', 0], image2: ['interpolate_middle', 0] });
    expect(graph.interpolated_target.inputs).toEqual({ image1: ['target_prefix', 0], image2: ['after', 0] });
    expect(plan.prefixFrames + plan.middleFrames + plan.suffixFrames).toBe(plan.totalFrames);
    expect(graph.encode_target.inputs).toEqual({ pixels: ['interpolated_target', 0], vae: ['video_vae', 0] });
    expect(graph.place_before.inputs.destination).toEqual(['encode_target', 0]);
    expect(graph.middle_strength.inputs.value).toBe(0.97);
    expect(graph.scale_middle_mask.inputs).toMatchObject({ destination: ['middle_mask', 0], source: ['middle_strength', 0], operation: 'multiply' });
    expect(graph.latent_mask.inputs.masks).toEqual(['scale_middle_mask', 0]);
    expect(graph.freeze_audio.inputs).toMatchObject({ start_time: plan.insertion.start, end_time: plan.insertion.start + plan.insertion.duration, existing_mask: 'replace' });
    expect(graph.conditioning.inputs.prompt).toBe('Exact prompt');
  });
  it.each([2, 7, 11.5])('fits motion interpolation to the exact interior frame count for %s seconds', duration => {
    const mode = duration < 5 ? 'loop' : 'bridge';
    const plan = comfyBridgePlan(1.625, 1.625, duration, mode);
    const graph = bridgeWorkflow('asset', { mode, before: 1.625, after: 1.625, duration, width: 960, height: 544, prompt: 'Exact', hasAudio: false, interpolateMiddle: true }, 123);
    let intervals = 1, previous = ['boundary_frames', 0];
    for (const [id, node] of Object.entries(graph).filter(([, node]) => node.class_type === 'FrameInterpolate')) {
      const multiplier = Number(node.inputs.multiplier);
      expect(multiplier).toBeGreaterThanOrEqual(2); expect(multiplier).toBeLessThanOrEqual(16);
      expect(node.inputs.images).toEqual(previous);
      intervals *= multiplier; previous = [id, 0];
    }
    expect(graph.interpolate_middle.inputs.image).toEqual(previous);
    const indexes = String(graph.interpolate_middle.inputs.indexes).split(',').map(Number);
    expect(indexes).toHaveLength(plan.middleFrames);
    expect(new Set(indexes).size).toBe(plan.middleFrames);
    expect(indexes[0]).toBeGreaterThan(0); expect(indexes.at(-1)).toBeLessThan(intervals);
    indexes.forEach((index, i) => expect(Math.abs(index / intervals - (i + 1) / (plan.middleFrames + 1))).toBeLessThanOrEqual(.5 / intervals + 1e-9));
  });
});
