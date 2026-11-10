import { describe, expect, it } from 'vitest';
import { bridgeWorkflow } from '../../server/features/comfy/workflow';
import { comfyBridgePlan } from '../../shared/comfy';
import { h3MaskGroups, inputMaskCurve, inputMaskStrength, referenceContent, validateInputRanges } from '../../shared/generation-inputs';
import { enabledImageReferences } from '../../shared/image-references';
import { interstitialSettings } from '../../shared/interstitials';
import { validateTimelineVideos } from '../../shared/video-references';

const base = { before: 1.625, after: 1.625, duration: 6, prompt: 'A scene', width: 960, height: 544, hasAudio: true };
const plan = comfyBridgePlan(base.before, base.after, base.duration);
const id = '11111111-1111-4111-8111-111111111111';
describe('combined generation inputs', () => {
  it('routes a guide and a preserved pixel frame through different paths with the same clock', () => {
    const graph = bridgeWorkflow('input-video', { ...base, fullInput: true, timelineInputs: [{ frame: 24, frames: 24 }], keyframes: [{ frame: 30, imageIndex: 0, method: 'guide' }, { frame: 70, imageIndex: 1, method: 'frame' }] }, 1, undefined, [], ['guide', 'frame']);
    expect(graph.keyframe_guide_0.inputs.frame_idx).toBe(plan.prefixFrames + 30);
    expect(graph.keyframe_guide_1).toBeUndefined();
    expect(graph.guider.inputs.conditioning).toEqual(['keyframe_guide_0', 0]);
    expect(graph.inject_frame_0_before.inputs.length).toBe(plan.prefixFrames + 70);
    expect(graph.inject_frame_0_after.inputs.batch_index).toBe(plan.prefixFrames + 71);
    expect(graph.encode_timeline.inputs.pixels).toEqual(['inject_frame_0_tail', 0]);
    expect(graph.latent_mask.inputs.temporal_method).toBe('min');
    expect(graph.encode_audio.inputs.audio).toEqual(['timeline_input', 2]);
    expect(graph.restore_frame_0_before.inputs.image).toEqual(['decode_video', 0]);
    expect(graph.output.inputs.images).toEqual(['restore_frame_0_tail', 0]);
    const mask = String(graph.middle_mask.inputs.points_string);
    expect(mask).toContain(`${plan.prefixFrames + 70}:(0.000000)`);
    expect(mask).toContain(`${plan.prefixFrames + 69}:(1.000000)`);
    expect(mask).toContain(`${plan.prefixFrames + 24}:(0.000000)`);
  });
  it('restores preserved frames after the optional 2K pass too', () => {
    const graph = bridgeWorkflow('input', { ...base, fullInput: true, resolution: '2k', keyframes: [{ frame: 40, imageIndex: 0, method: 'frame' }] }, 1, undefined, [], ['image']);
    expect(graph.regenerated_components.inputs.video).toEqual(['regenerate_2k', 0]);
    expect(graph.preserved_2k_video.inputs.audio).toEqual(['regenerated_components', 1]);
    expect(graph.output.inputs.video).toEqual(['preserved_2k_video', 0]);
  });
  it('does not silence audio for preserved images, including when no reference footage is connected', () => {
    const input = { ...base, mode: 'custom' as const, before: 0, after: 0, fullInput: true };
    const graph = bridgeWorkflow('blank', { ...input, keyframes: [{ frame: 48, imageIndex: 0, method: 'frame' }] }, 1, undefined, [], ['image']);
    expect(graph.audio_mask_base.inputs.value).toBe(1);
    expect(Object.keys(graph).filter(key => key.startsWith('audio_timeline_mask_'))).toEqual([]);
  });
  it('rejects missing full inputs, overlapping clips and clips beyond the body', () => {
    expect(() => bridgeWorkflow('video', { ...base, keyframes: [{ frame: 10, imageIndex: 0, method: 'frame' }] }, 1, undefined, [], ['image'])).toThrow('complete timeline');
    expect(() => validateInputRanges([{ frame: 10, frames: 20 }, { frame: 15, frames: 10 }], 100)).toThrow('overlapping');
    expect(() => validateInputRanges([{ frame: 90, frames: 20 }], 100)).toThrow('fit');
    expect(() => validateTimelineVideos([{ id: 'missing', frame: 10, enabled: true }], 100)).toThrow('Choose a video');
    expect(() => validateTimelineVideos([{ id: 'disabled', frame: 10, enabled: false }], 100)).not.toThrow();
  });
  it('always generates blank regions even when the saved body curve says keep', () => {
    const curve = inputMaskCurve(undefined, 1, 1, 0), content = referenceContent(24, 96, 24, [{ frame: 24, frames: 24 }]);
    expect(inputMaskStrength(curve, 30, 24, 96, 24, content)).toBe(1);
    expect(inputMaskStrength(curve, 60, 24, 96, 24, content)).toBe(0);
    const graph = bridgeWorkflow('video', { ...base, videoMaskCurve: curve }, 1);
    expect(graph.middle_mask.inputs.points_string).toContain(`${plan.prefixFrames + 10}:(1)`);
  });
  it('records video positions and keyframe methods in undo/metadata settings', () => {
    const settings = interstitialSettings({ start_range: 1, end_range: 1, duration: 6, prompt: 'A scene', enable_prompt_expansion: false,
      timelineVideos: [{ id: 'clip', frame: 24, enabled: true, video: { assetId: id, name: 'clip', inFrame: 12, outFrame: 36 } }], keyframes: [{ id: 'pose', frame: 50, enabled: true, method: 'frame', image: { assetId: id, name: 'pose' } }] });
    expect(settings.timelineVideos?.[0].video?.inFrame).toBe(12);
    expect(settings.keyframes?.[0].method).toBe('frame');
  });
  it('exposes H3 mask cell boundaries on the actual full-video clock', () => {
    expect(h3MaskGroups(22)).toEqual([{ start: 0, end: 1 }, { start: 1, end: 5 }, { start: 5, end: 9 }, { start: 9, end: 13 }, { start: 13, end: 17 }, { start: 17, end: 18 }, { start: 18, end: 22 }]);
  });
});

describe('disabled image references', () => {
  const refs = [{ assetId: id, name: 'disabled', enabled: false }, { assetId: id, name: 'active' }];
  it('omits disabled images and remaps active prompt tags and endpoints without changing saved settings', () => {
    const item = { imageReferences: refs, startImageIndex: 0, endImageIndex: 1, prompt: 'Use <Picture 2>.' };
    expect(enabledImageReferences(item)).toEqual({ imageReferences: [refs[1]], prompt: 'Use <Picture 1>.', startImageIndex: undefined, endImageIndex: 0 });
    expect(item.imageReferences).toHaveLength(2); expect(item.prompt).toContain('2');
  });
  it('identifies a prompt that still requests a disabled image', () => {
    expect(() => enabledImageReferences({ imageReferences: refs, prompt: 'Use <Picture 1>.' })).toThrow('disabled Picture 1');
  });
});
