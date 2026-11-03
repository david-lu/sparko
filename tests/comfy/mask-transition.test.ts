import { describe, expect, it } from 'vitest';
import { comfyBridgePlan } from '../../shared/comfy';
import { bridgeWorkflow } from '../../server/features/comfy/workflow';

// Interpret the public CreateFadeMaskAdvanced linear-keyframe contract.
function values(pointsString: string, frames: number) {
  const points = pointsString.split(',').map(point => point.split(':').map(value => Number(value.replace(/[()]/g, ''))));
  return Array.from({ length: frames }, (_, frame) => {
    const right = points.findIndex(([time]) => time >= frame);
    if (right === 0) return points[0][1];
    const [a, va] = points[right - 1], [b, vb] = points[right];
    return va + (vb - va) * (frame - a) / (b - a);
  });
}
const references = [[1.625, 1.625], [3, 2], [1.625, 0], [0, 1.625], [0, 0]];

describe('independent audio/video transition durations', () => {
  for (const [audioMaskTransitionMs, videoMaskTransitionMs] of [[0, 0], [200, 200], [500, 500], [1000, 1000], [4000, 4000], [0, 500], [500, 0], [250, 1000], [1000, 250]]) it.each(references)(`audio ${audioMaskTransitionMs} / video ${videoMaskTransitionMs} ms never partially masks the gap with references %s / %s`, (before, after) => {
    const plan = comfyBridgePlan(before, after, 6, 'custom');
    const graph = bridgeWorkflow(before || after ? 'asset' : undefined,
      { before, after, duration: 6, mode: 'custom', width: 960, height: 544, hasAudio: true, prompt: 'Continue', audioMaskTransitionMs, videoMaskTransitionMs }, 1);
    const end = plan.totalFrames - plan.suffixFrames;
    if (videoMaskTransitionMs && (before || after)) {
      expect(graph.middle_mask.class_type).toBe('CreateFadeMaskAdvanced');
      const mask = values(String(graph.middle_mask.inputs.points_string), plan.totalFrames);
      expect(mask.slice(plan.prefixFrames, end).every(value => value === 1)).toBe(true);
      expect(mask.every(value => value >= 0 && value <= 1)).toBe(true);
      const partial = mask.flatMap((value, frame) => value > 0 && value < 1 ? [frame] : []);
      expect(partial.every(frame => frame < plan.prefixFrames || frame >= end)).toBe(true);
      expect(partial.some(frame => frame < plan.prefixFrames)).toBe(!!before);
      expect(partial.some(frame => frame >= end)).toBe(!!after);
      const fadeFrames = Math.round(videoMaskTransitionMs / 1000 * 24);
      if (before) expect(mask.slice(0, Math.max(0, plan.prefixFrames - fadeFrames)).every(value => value === 0)).toBe(true);
      if (after) expect(mask.slice(Math.min(plan.totalFrames - 1, end + fadeFrames)).every(value => value === 0)).toBe(true);
    } else {
      expect(graph.middle_mask).toMatchObject({ class_type: 'MVEx_FrameRangeMask', inputs: { ranges: `${plan.prefixFrames}:${end}` } });
    }
    if (before || after) {
      const x = Number(graph.audio_mask.inputs.x), left = Number(graph.audio_mask_feather.inputs.left), right = Number(graph.audio_mask_feather.inputs.right);
      const gapFirst = Math.floor(plan.insertion.start * 40), gapEnd = Math.ceil((plan.insertion.start + plan.insertion.duration) * 40);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + left).toBeLessThanOrEqual(gapFirst);
      expect(left).toBe(before ? Math.min(Math.round(audioMaskTransitionMs / 25), gapFirst) : 0);
      if (after) {
        expect(x + Number(graph.audio_mask_middle.inputs.width) - right).toBeGreaterThanOrEqual(gapEnd);
        expect(right).toBeLessThanOrEqual(Math.floor(plan.suffixFrames / 24 * 40));
      } else expect(right).toBe(0);
    } else expect(graph.audio_mask).toBeUndefined();
  });
  it('softens video when the input has no audio', () => {
    const graph = bridgeWorkflow('asset', { before: 1.625, after: 0, duration: 6, mode: 'custom', width: 960, height: 544, hasAudio: false, prompt: 'Continue' }, 1);
    expect(graph.middle_mask.class_type).toBe('CreateFadeMaskAdvanced');
    expect(graph.freeze_video.inputs.mask).toEqual(['latent_mask', 0]);
    expect(graph.latent_mask.inputs.temporal_method).toBe('max');
    expect(graph.audio_mask).toBeUndefined();
  });
  for (const field of ['audioMaskTransitionMs', 'videoMaskTransitionMs'] as const) it.each([-1, 4001, NaN, Infinity, .5])(`refuses invalid ${field}: %s`, value => {
    expect(() => bridgeWorkflow('asset', { before: 1.625, after: 0, duration: 6, mode: 'custom', width: 960, height: 544, hasAudio: true, prompt: 'Continue', [field]: value }, 1)).toThrow(/mask transition/);
  });
});
