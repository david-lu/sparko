import { describe, expect, it } from 'vitest';
import { comfyStepProgress, comfyStage } from '../../shared/comfy-progress';
import { generationProgress } from '../../server/features/comfy/progress';
import { phaseLabel, renderingProgress } from '../../src/features/interstitials/status';
import type { Interstitial } from '../../shared/interstitials';

const job = (patch: Partial<Interstitial> = {}): Interstitial => ({
  id: 'progress-test', label: 'Call', time: 3, method: 'comfy-extend', requestMethod: 'comfy-extend',
  phase: 'rendering', prompt: 'Continue', duration: 6, start_range: 2, end_range: 2, enable_prompt_expansion: false,
  ...patch,
});

describe('Comfy stage progress', () => {
  it('names official H3 2K regeneration without inventing a time estimate for the hosted pass',()=>{
    expect(comfyStage('regenerate_2k')).toBe('Regenerating with H3 2K');expect(comfyStage(undefined,'MinimaxHailuo03RegenerateNode')).toBe('Regenerating with H3 2K');
    const item=job({progress:.98,progressDetails:{stage:comfyStage('regenerate_2k'),nodesDone:30,nodesTotal:31}});
    expect(renderingProgress(item)).toBeUndefined();expect(phaseLabel(item)).toBe('Regenerating with H3 2K');
    expect(renderingProgress({...item,progress:undefined})).toBeUndefined();
    expect(phaseLabel({...item,progressDetails:{...item.progressDetails!,step:7,steps:20}})).toBe('35% of stage · Regenerating with H3 2K · step 7/20');
  });
  it('shows the actual 35% sampling progress even when the workflow aggregate is 98%', () => {
    const reported = generationProgress({ value: .98, current_node: 'sample', step: 7, steps: 20, nodes_done: 32, nodes_total: 33 });
    const item = job(reported);
    expect(item.progress).toBe(.98); // Retain the original provider snapshot.
    expect(renderingProgress(item)).toBe(.35);
    expect(phaseLabel(item)).toBe('35% of stage · Generating video and audio · step 7/20');
    expect(comfyStepProgress({ ...reported.progressDetails, step: 0 })).toBe(0);
    expect(comfyStepProgress({ ...reported.progressDetails, step: 20 })).toBe(1);
    expect(phaseLabel({...item,progressDetails:{...reported.progressDetails,step:20}})).toBe('100% of stage · Generating video and audio · step 20/20');
  });
  it('does not invent percentages for setup or finishing stages', () => {
    for (const node of ['conditioning', 'streams', 'decode_video', 'decode_audio', 'output']) {
      const item=job({progress:.98,progressDetails:{stage:comfyStage(node),nodesDone:25,nodesTotal:33}});
      expect(renderingProgress(item)).toBeUndefined();
      expect(phaseLabel(item)).toBe(comfyStage(node));
    }
    expect(comfyStepProgress({ stage: comfyStage('decode_video'), step: 1, steps: 4 })).toBe(.25);
    expect(phaseLabel(job({ phase: 'ready' }))).toBe('Ready');
  });
  it.each([{}, { step: 9 }, { step: 9, steps: 0 }, { step: NaN, steps: 20 }, {step:-1,steps:20}, {step:7,steps:Infinity}, {step:1.5,steps:20}])('keeps progress indeterminate if sampler steps are missing or invalid: %j', counts => {
    const item = job({ progress: .98, progressDetails: { stage: comfyStage('sample'), ...counts } });
    expect(renderingProgress(item)).toBeUndefined();
    expect(phaseLabel(item)).toBe('Generating video and audio');
  });
  it('does not use the live Cloud aggregate as render progress when stage and step counts are absent', () => {
    const item = job(generationProgress({ value: .9892857142857142, nodes_done: 27, nodes_total: 28 }));
    expect(renderingProgress(item)).toBeUndefined();
    expect(phaseLabel(item)).toBe('Generating scene');
    expect(phaseLabel(JSON.parse(JSON.stringify(item)))).toBe(phaseLabel(item));
    for(const progress of [.42,0,1])expect(phaseLabel(job({ progress }))).toBe('Generating scene');
  });
  it.each([undefined, NaN, Infinity, -1, 2])('keeps missing or invalid progress indeterminate: %s', progress => {
    const item = job({ progress, progressDetails: { stage: 'Generating scene', nodesDone: 27, nodesTotal: 28 } });
    expect(renderingProgress(item)).toBeUndefined();
    expect(phaseLabel(item)).toBe('Generating scene');
  });
  it('keeps actual Comfy step progress after saving and loading', () => {
    const item = job({ progress: .98, progressDetails: { stage: comfyStage('numeric-id', 'SamplerCustomAdvanced'), step: 9, steps: 20 } });
    expect(renderingProgress(JSON.parse(JSON.stringify(item)))).toBe(.45);
    expect(phaseLabel(item)).toContain('45% of stage');
    expect(phaseLabel({ ...item, phase: 'loading', progress: .25, progressDetails: { stage: 'Downloading generated video' } })).toBe('Downloading generated video · 25%');
  });
});
