import { describe, expect, it } from 'vitest';
import { estimateComfyProgress, comfyStage } from '../../shared/comfy-progress';
import { generationProgress } from '../../server/features/comfy/progress';
import { phaseLabel, renderingProgress } from '../../src/features/interstitials/status';
import type { Interstitial } from '../../shared/interstitials';

const job = (patch: Partial<Interstitial> = {}): Interstitial => ({
  id: 'progress-test', label: 'Call', time: 3, method: 'comfy-extend', requestMethod: 'comfy-extend',
  phase: 'rendering', prompt: 'Continue', duration: 6, start_range: 2, end_range: 2, enable_prompt_expansion: false,
  ...patch,
});

describe('Comfy render progress estimates', () => {
  it('weights the sampler at 90% instead of displaying the inflated node aggregate', () => {
    const reported = generationProgress({ value: .98, current_node: 'sample', step: 9, steps: 20, nodes_done: 32, nodes_total: 33 });
    const item = job(reported);
    expect(item.progress).toBe(.98); // Retain the original provider snapshot.
    expect(renderingProgress(item)).toBeCloseTo(.05 + .9 * .45);
    expect(phaseLabel(item)).toBe('Generating video and audio · step 9/20 · 46% estimated overall');
    const start = estimateComfyProgress({ ...reported.progressDetails, step: 0 })!;
    const end = estimateComfyProgress({ ...reported.progressDetails, step: 20 })!;
    expect(start).toBeCloseTo(.05);
    expect(end - start).toBeCloseTo(.9);
    expect(end).toBeCloseTo(.95);
  });
  it('reserves preparation and finishing work without claiming completion before the output is ready', () => {
    expect(estimateComfyProgress({ stage: comfyStage('conditioning'), nodesDone: 25, nodesTotal: 33 })).toBeLessThan(.05);
    for (const node of ['streams', 'decode_video', 'decode_audio', 'output']) {
      const progress = estimateComfyProgress({ stage: comfyStage(node) })!;
      expect(progress).toBeGreaterThanOrEqual(.95);
      expect(progress).toBeLessThan(1);
    }
    expect(estimateComfyProgress({ stage: comfyStage('output'), step: 1, steps: 1 })).toBe(.99);
    expect(phaseLabel(job({ phase: 'ready' }))).toBe('Ready');
  });
  it.each([{}, { step: 9 }, { step: 9, steps: 0 }, { step: NaN, steps: 20 }])('uses indeterminate progress if sampler steps are missing or invalid: %j', counts => {
    const item = job({ progress: .98, progressDetails: { stage: comfyStage('sample'), ...counts } });
    expect(renderingProgress(item)).toBeUndefined();
    expect(phaseLabel(item)).not.toContain('%');
  });
  it('does not substitute node counts or aggregate values for an unknown stage', () => {
    expect(renderingProgress(job({ progress: .98 }))).toBeUndefined();
    expect(renderingProgress(job({ progress: .98, progressDetails: { stage: 'Generating scene', nodesDone: 32, nodesTotal: 33 } }))).toBeUndefined();
  });
  it('uses the submitted Comfy provider after editable settings change and after reload', () => {
    const item = job({ method: 'fal', progress: .98, progressDetails: { stage: comfyStage('numeric-id', 'SamplerCustomAdvanced'), step: 9, steps: 20 } });
    expect(renderingProgress(JSON.parse(JSON.stringify(item)))).toBeCloseTo(.455);
    expect(phaseLabel(item)).toContain('46% estimated overall');
    expect(renderingProgress({ ...item, requestMethod: 'fal' })).toBe(.98);
    expect(phaseLabel({ ...item, phase: 'loading', progress: .25, progressDetails: { stage: 'Downloading generated video' } })).toBe('Downloading generated video · 25%');
  });
});
