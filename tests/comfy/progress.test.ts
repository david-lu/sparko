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
  it('names official H3 2K regeneration without inventing a time estimate for the hosted pass',()=>{
    expect(comfyStage('regenerate_2k')).toBe('Regenerating with H3 2K');expect(comfyStage(undefined,'MinimaxHailuo03RegenerateNode')).toBe('Regenerating with H3 2K');
    const item=job({progress:.98,progressDetails:{stage:comfyStage('regenerate_2k'),nodesDone:30,nodesTotal:31}});
    expect(renderingProgress(item)).toBe(.98);expect(phaseLabel(item)).toBe('98% reported by Comfy · Regenerating with H3 2K');
    expect(renderingProgress({...item,progress:undefined})).toBeUndefined();
  });
  it('weights the sampler at 90% instead of displaying the inflated node aggregate', () => {
    const reported = generationProgress({ value: .98, current_node: 'sample', step: 9, steps: 20, nodes_done: 32, nodes_total: 33 });
    const item = job(reported);
    expect(item.progress).toBe(.98); // Retain the original provider snapshot.
    expect(renderingProgress(item)).toBeCloseTo(.05 + .9 * .45);
    expect(phaseLabel(item)).toBe('46% estimated overall · Generating video and audio · step 9/20');
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
  it.each([{}, { step: 9 }, { step: 9, steps: 0 }, { step: NaN, steps: 20 }])('falls back to reported progress if sampler steps are missing or invalid: %j', counts => {
    const item = job({ progress: .98, progressDetails: { stage: comfyStage('sample'), ...counts } });
    expect(renderingProgress(item)).toBe(.98);
    expect(phaseLabel(item)).toContain('98% reported by Comfy');
  });
  it('displays the live Cloud payload that omits the current node and sampler steps', () => {
    const item = job(generationProgress({ value: .9892857142857142, nodes_done: 27, nodes_total: 28 }));
    expect(renderingProgress(item)).toBe(.9892857142857142);
    expect(phaseLabel(item)).toBe('99% reported by Comfy · Generating scene');
    expect(phaseLabel(JSON.parse(JSON.stringify(item)))).toBe(phaseLabel(item));
    expect(phaseLabel(job({ progress: .42 }))).toBe('42% reported by Comfy · Generating scene');
    expect(phaseLabel(job({ progress: 0 }))).toBe('0% reported by Comfy · Generating scene');
    expect(phaseLabel(job({ progress: 1 }))).toBe('99% reported by Comfy · Generating scene');
  });
  it.each([undefined, NaN, Infinity, -1, 2])('keeps missing or invalid progress indeterminate: %s', progress => {
    const item = job({ progress, progressDetails: { stage: 'Generating scene', nodesDone: 27, nodesTotal: 28 } });
    expect(renderingProgress(item)).toBeUndefined();
    expect(phaseLabel(item)).toBe('Generating scene');
  });
  it('keeps Comfy progress estimates after saving and loading', () => {
    const item = job({ progress: .98, progressDetails: { stage: comfyStage('numeric-id', 'SamplerCustomAdvanced'), step: 9, steps: 20 } });
    expect(renderingProgress(JSON.parse(JSON.stringify(item)))).toBeCloseTo(.455);
    expect(phaseLabel(item)).toContain('46% estimated overall');
    expect(phaseLabel({ ...item, phase: 'loading', progress: .25, progressDetails: { stage: 'Downloading generated video' } })).toBe('Downloading generated video · 25%');
  });
});
