import { describe, expect, it } from 'vitest';
import { bridgeWorkflow } from '../../server/features/comfy/workflow';
import { comfyBridgePlan } from '../../shared/comfy';
import { COMFY, TIMELINE_FPS } from '../../shared/constants';
import { audioMaskColumns, contentGaps, inputMaskCurve, inputMaskStrength, mergeRanges, referenceContent, validateContentRanges } from '../../shared/generation-inputs';
import type { GenerationReference, InterstitialSettings } from '../../shared/interstitials';
import { inputAudioContent } from '../../src/features/interstitials/input-content';

const id = (n: number) => `${n}1111111-1111-4111-8111-111111111111`;
const settings = { start_range: 1, end_range: 1, duration: 4, prompt: 'A scene', enable_prompt_expansion: false } as InterstitialSettings;
const plan = { prefixFrames: 24, middleFrames: 96, suffixFrames: 24 };
const clip = (n: number, kind?: 'image') => ({ sceneId: `scene-${n}`, assetId: id(n), inFrame: 0, outFrame: 48, ...kind ? { kind } : {} });
const bridge: GenerationReference = { mode: 'bridge', before: clip(1), after: clip(2) };
const everything = () => true;

describe('input content', () => {
  it('merges spans and finds the gaps between them', () => {
    expect(mergeRanges([{ frame: 30, frames: 10 }, { frame: 0, frames: 10 }, { frame: 10, frames: 5 }, { frame: 32, frames: 20 }]))
      .toEqual([{ frame: 0, frames: 15 }, { frame: 30, frames: 22 }]);
    expect(contentGaps([{ frame: 10, frames: 10 }, { frame: 30, frames: 10 }], 50)).toEqual([{ frame: 0, frames: 10 }, { frame: 20, frames: 10 }, { frame: 40, frames: 10 }]);
    expect(referenceContent(24, 96, 24, [{ frame: 0, frames: 10 }])).toEqual([{ frame: 0, frames: 34 }, { frame: 120, frames: 24 }]);
    expect(() => validateContentRanges([{ frame: 0, frames: 30 }, { frame: 20, frames: 10 }], 144)).toThrow('without overlapping');
    expect(() => validateContentRanges([{ frame: 140, frames: 10 }], 144)).toThrow('inside the render');
  });

  it('keeps input in the generated section by default and always regenerates spans without input', () => {
    const curve = inputMaskCurve(undefined, 1, 1, 250);
    expect(curve.body).toEqual([{ position: 0, strength: 0 }, { position: 1, strength: 0 }]);
    const content = referenceContent(24, 96, 24, [{ frame: 40, frames: 20 }]);
    expect(inputMaskStrength(curve, 70, 24, 96, 24, content)).toBe(0);
    expect(inputMaskStrength(curve, 30, 24, 96, 24, content)).toBe(1);
    // A freely drawn body curve applies wherever there is input, and only there.
    const drawn = { ...curve, body: [{ position: 0, strength: .3 }, { position: 1, strength: .3 }] };
    expect(inputMaskStrength(drawn, 70, 24, 96, 24, content)).toBeCloseTo(.3);
    expect(inputMaskStrength(drawn, 100, 24, 96, 24, content)).toBe(1);
    // Reference footage with nothing to keep regenerates too.
    expect(inputMaskStrength(curve, 5, 24, 96, 24, [{ frame: 40, frames: 20 }])).toBe(1);
    expect(inputMaskStrength(curve, 5, 24, 96, 24, content)).toBe(0);
  });

  it('finds sound only where the input movie is audible', () => {
    expect(inputAudioContent(settings, bridge, plan, everything)).toEqual([{ frame: 0, frames: 24 }, { frame: 120, frames: 24 }]);
    // A loop holds its first frame at the end; that still is silent.
    expect(inputAudioContent(settings, { mode: 'loop', before: clip(1) }, plan, everything)).toEqual([{ frame: 0, frames: 24 }]);
    // Muted sides, stills and footage without an audio track have no sound.
    expect(inputAudioContent({ ...settings, startReferenceVolume: 0 }, bridge, plan, everything)).toEqual([{ frame: 120, frames: 24 }]);
    expect(inputAudioContent(settings, { ...bridge, before: clip(1, 'image') }, plan, everything)).toEqual([{ frame: 120, frames: 24 }]);
    expect(inputAudioContent(settings, bridge, plan, assetId => assetId !== id(2))).toEqual([{ frame: 0, frames: 24 }]);
    // Unknown footage counts as sound until it is checked.
    expect(inputAudioContent(settings, bridge, plan, () => undefined)).toEqual([{ frame: 0, frames: 24 }, { frame: 120, frames: 24 }]);
  });

  it('counts audible timeline videos and every audible sound, including sound over a silent reference', () => {
    const video = (volume?: number) => ({ id: 'v', frame: 10, enabled: true, volume, video: { assetId: id(3), name: 'Video', inFrame: 0, outFrame: 20 } });
    expect(inputAudioContent({ ...settings, timelineVideos: [video()] }, bridge, plan, everything)).toContainEqual({ frame: 34, frames: 20 });
    expect(inputAudioContent({ ...settings, timelineVideos: [video(0)] }, bridge, plan, everything)).not.toContainEqual({ frame: 34, frames: 20 });
    expect(inputAudioContent({ ...settings, timelineVideos: [video()] }, bridge, plan, assetId => assetId !== id(3))).not.toContainEqual({ frame: 34, frames: 20 });
    const track = (volume: number) => ({ id: 't', name: 'Audio 1', muted: false, clips: [{ id: 's', assetId: id(4), name: 'Line', frame: 100, inFrame: 0, outFrame: 30, volume }] });
    // The sound runs from the generated section into the held loop end.
    expect(inputAudioContent({ ...settings, inputAudioTracks: [track(1)] }, { mode: 'loop', before: clip(1) }, plan, everything))
      .toEqual([{ frame: 0, frames: 24 }, { frame: 124, frames: 20 }]);
    expect(inputAudioContent({ ...settings, inputAudioTracks: [track(0)] }, { mode: 'loop', before: clip(1) }, plan, everything)).toEqual([{ frame: 0, frames: 24 }]);
  });
});

describe('content-aware masks sent to H3', () => {
  const base = { before: 1.625, after: 1.625, duration: 6, prompt: 'A scene', width: 960, height: 544, hasAudio: true };
  const full = comfyBridgePlan(base.before, base.after, base.duration);
  const suffixStart = full.prefixFrames + full.middleFrames;
  const audioSpans = (graph: ReturnType<typeof bridgeWorkflow>) => Object.keys(graph).filter(key => key.startsWith('audio_timeline_value_'))
    .map(key => ({ x: Number(graph[key.replace('value', 'mask')].inputs.x), width: Number(graph[key].inputs.width), strength: Number(graph[key].inputs.value) }));
  const firstSuffixColumn = Math.ceil(suffixStart / TIMELINE_FPS * COMFY.audioLatentsPerSecond) + 1;

  it('regenerates a silent reference in the full timeline input while keeping audible ones', () => {
    const input = { ...base, fullInput: true, timelineAudioInputs: [{ frame: 0, frames: 24 }] };
    const kept = audioSpans(bridgeWorkflow('input', input, 1));
    expect(kept.some(span => span.x <= firstSuffixColumn && span.x + span.width > firstSuffixColumn)).toBe(true);
    const audioContent = [{ frame: 0, frames: full.prefixFrames + 24 }];
    const silent = audioSpans(bridgeWorkflow('input', { ...input, audioContent }, 1));
    expect(silent.some(span => span.x + span.width > firstSuffixColumn)).toBe(false);
    expect(silent.some(span => span.x === 0)).toBe(true);
    expect(audioMaskColumns(inputMaskCurve(undefined, base.before, base.after, 0), full.prefixFrames, full.middleFrames, full.suffixFrames, audioContent).slice(firstSuffixColumn).every(value => value === 1)).toBe(true);
  });

  it('regenerates a silent loop end in reference-only generation and leaves other requests unchanged', () => {
    const loop = { ...base, mode: 'loop' as const };
    const plain = bridgeWorkflow('reference', loop, 1);
    expect(plain.audio_mask_feather).toBeDefined();
    const graph = bridgeWorkflow('reference', { ...loop, audioContent: [{ frame: 0, frames: full.prefixFrames }] }, 1);
    expect(graph.audio_mask_feather).toBeUndefined();
    const curveSpans = (value: typeof graph) => Object.keys(value).filter(key => key.startsWith('audio_curve_value_'))
      .map(key => ({ x: Number(value[key.replace('_value', '')].inputs.x), width: value[key].inputs.width, strength: Number(value[key].inputs.value) }));
    const spans = curveSpans(graph), lastColumn = Math.floor(full.totalFrames / TIMELINE_FPS * COMFY.audioLatentsPerSecond) - 2;
    const at = (column: number) => spans.filter(span => span.x <= column && (typeof span.width !== 'number' || span.x + span.width > column)).reduce((sum, span) => sum + span.strength, 0);
    // Everything from the seam through the padding after the held frame regenerates.
    for (const column of [firstSuffixColumn, firstSuffixColumn + 10, lastColumn]) expect(at(column)).toBe(1);
    expect(spans.at(-1)).toMatchObject({ strength: 1 });
    // The start reference keeps its sound as before.
    expect(at(2)).toBe(0);
    // Sound that covers both references needs no change.
    expect(bridgeWorkflow('reference', { ...base, audioContent: referenceContent(full.prefixFrames, full.middleFrames, full.suffixFrames, []) }, 1).audio_mask_feather).toBeDefined();
    expect(() => bridgeWorkflow('reference', { ...base, audioContent: [{ frame: 0, frames: full.totalFrames + 1 }] }, 1)).toThrow('inside the render');
  });
});
