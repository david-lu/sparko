import { describe, expect, it, vi } from 'vitest';
import { audibleClips, audioInputRanges, audioTracksSchema, freeAudioFrame, nextAudioTrackName, placeAudioClip, type AudioTrack, type AudioTrackClip } from '../../shared/audio-tracks';
import { bridgeWorkflow } from '../../server/features/comfy/workflow';
import { comfyBridgePlan } from '../../shared/comfy';
import { COMFY, TIMELINE_FPS } from '../../shared/constants';
import { inputAudioMaskStrength, inputMaskCurve } from '../../shared/generation-inputs';
import { hasUnsubmittedChanges, interstitialSettings, type Interstitial, type InterstitialResult } from '../../shared/interstitials';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { assetIds, emptyAnalysis, type Project } from '../../src/features/project/types';
import { ProjectHistory } from '../../src/features/project/ProjectHistory';
import { assetUsage } from '../../src/features/project/assetUsage';
import { clipAudioLayers, generatedClipAudio } from '../../src/features/player/clipAudioTracks';
import { assets } from '../../src/features/project/assets';
import type { PlaybackLayer } from '../../src/features/player/CanvasMediaDecks';

const voice: string = crypto.randomUUID(), music: string = crypto.randomUUID();
const sound = (patch: Partial<AudioTrackClip> = {}): AudioTrackClip => ({ id: crypto.randomUUID(), assetId: voice, name: 'Line.wav', frame: 0, inFrame: 0, outFrame: 24, volume: 1, ...patch });
const track = (clips: AudioTrackClip[], patch: Partial<AudioTrack> = {}): AudioTrack => ({ id: crypto.randomUUID(), name: 'Audio 1', muted: false, clips, ...patch });
const settings = { start_range: 1.625, end_range: 1.625, duration: 6, prompt: 'A scene', enable_prompt_expansion: false };

describe('generation audio tracks', () => {
  it('cuts sounds to the timeline and skips muted tracks and silent sounds', () => {
    const early = sound({ frame: -30, inFrame: 6, outFrame: 54 }), late = sound({ frame: 100, outFrame: 48 });
    expect(audibleClips([track([early, late]), track([sound()], { muted: true }), track([sound({ volume: 0 })])], 24, 140)).toEqual([
      { track: expect.anything(), clip: early, startFrame: 0, endFrame: 42, inFrame: 12, volume: 1 },
      { track: expect.anything(), clip: late, startFrame: 124, endFrame: 140, inFrame: 0, volume: 1 },
    ]);
  });
  it('merges input sound across tracks into spans of the generated section only', () => {
    const tracks = [track([sound({ frame: -10, outFrame: 20 }), sound({ frame: 40, outFrame: 30 })]), track([sound({ frame: 60, outFrame: 30 }), sound({ frame: 140, outFrame: 30 })])];
    expect(audioInputRanges(tracks, 39, 144)).toEqual([{ frame: 0, frames: 10 }, { frame: 40, frames: 50 }, { frame: 140, frames: 4 }]);
    expect(audioInputRanges([track([sound({ frame: -30 })])], 39, 144)).toEqual([]);
  });
  it('places sounds in gaps without overlapping others on the same track', () => {
    const a = sound({ frame: 0, outFrame: 24 }), b = sound({ frame: 48, outFrame: 24 }), c = sound({ frame: 100, outFrame: 10 }), t = track([a, b, c]);
    expect(freeAudioFrame(t, 10, 20)).toBe(24);
    expect(freeAudioFrame(t, 10, 28)).toBe(72);
    expect(freeAudioFrame(t, 10, 30)).toBe(110);
    expect(placeAudioClip(t, b, 30, -24, 200)).toBe(30);
    expect(placeAudioClip(t, b, 10, -24, 200)).toBe(24); // stops at the previous sound
    expect(placeAudioClip(t, b, 90, -24, 200)).toBe(76); // stops before the next sound
    expect(placeAudioClip(t, a, 120, -24, 200)).toBe(120); // jumps into a free gap
    expect(placeAudioClip(t, a, -100, -24, 200)).toBe(-24);
    expect(nextAudioTrackName([track([], { name: 'Audio 2' })])).toBe('Audio 3');
  });
  it('validates shape, limits and unique identities', () => {
    const a = sound();
    expect(audioTracksSchema.safeParse([track([a])]).success).toBe(true);
    for (const patch of [{ inFrame: 24 }, { frame: .5 }, { volume: 2 }, { frame: -COMFY.maxFrames - 1 }]) expect(audioTracksSchema.safeParse([track([{ ...a, ...patch }])]).success).toBe(false);
    expect(audioTracksSchema.safeParse([track([a]), track([a])]).success).toBe(false);
    expect(audioTracksSchema.safeParse(Array.from({ length: 9 }, () => track([]))).success).toBe(false);
  });
  it('keeps input sound in the audio mask without freezing the picture', () => {
    const base = { before: 1.625, after: 1.625, duration: 6, prompt: 'A scene', width: 960, height: 544, hasAudio: true, fullInput: true };
    const plan = comfyBridgePlan(base.before, base.after, base.duration);
    const graph = bridgeWorkflow('input', { ...base, timelineAudioInputs: [{ frame: 24, frames: 24 }] }, 1);
    const kept = Object.keys(graph).filter(key => key.startsWith('audio_timeline_mask_')).map(key => graph[key].inputs)
      .filter(inputs => graph[(inputs.source as string[])[0]].inputs.value === 0 && (inputs.x as number) > (plan.prefixFrames + 10) / TIMELINE_FPS * COMFY.audioLatentsPerSecond
        && (inputs.x as number) < (plan.prefixFrames + plan.middleFrames) / TIMELINE_FPS * COMFY.audioLatentsPerSecond);
    const first = Math.ceil((plan.prefixFrames + 24) / TIMELINE_FPS * COMFY.audioLatentsPerSecond);
    expect(kept).toHaveLength(1);
    expect(kept[0].x).toBe(first);
    expect(graph[(kept[0].source as string[])[0]].inputs.width).toBe(Math.floor((plan.prefixFrames + 48) / TIMELINE_FPS * COMFY.audioLatentsPerSecond) - first);
    expect(graph.middle_mask.inputs.points_string).toContain(`${plan.prefixFrames + 30}:(1.000000)`);
    const silent = bridgeWorkflow('input', base, 1);
    expect(Object.keys(silent).filter(key => key.startsWith('audio_timeline_value_')).map(key => silent[key].inputs)
      .some(inputs => inputs.value === 0 && (inputs.width as number) > 0 && inputs.width === kept[0].width)).toBe(false);
    expect(() => bridgeWorkflow('input', { ...base, fullInput: false, timelineAudioInputs: [{ frame: 24, frames: 24 }] }, 1)).toThrow('complete timeline');
    expect(() => bridgeWorkflow('input', { ...base, timelineAudioInputs: [{ frame: 140, frames: 24 }] }, 1)).toThrow('Input audio spans');
  });
  it('always regenerates audio at the seams between references and the generated section', () => {
    const base = { before: 1.625, after: 1.625, duration: 6, prompt: 'A scene', width: 960, height: 544, hasAudio: true, fullInput: true };
    const plan = comfyBridgePlan(base.before, base.after, base.duration), rate = COMFY.audioLatentsPerSecond;
    const columns = (input: Partial<typeof base> & Record<string, unknown>) => {
      const graph = bridgeWorkflow('input', { ...base, ...input }, 1), values = new Array(Math.floor(plan.totalFrames / TIMELINE_FPS * rate)).fill(1);
      for (const key of Object.keys(graph).filter(key => key.startsWith('audio_timeline_mask_'))) {
        const { x, source } = graph[key].inputs, { value, width } = graph[(source as string[])[0]].inputs;
        for (let i = 0; i < (width as number); i++) values[(x as number) + i] = value;
      }
      return values;
    };
    const start = plan.prefixFrames / TIMELINE_FPS * rate, end = (plan.prefixFrames + plan.middleFrames) / TIMELINE_FPS * rate;
    for (const audioMaskTransitionMs of [0, 250]) {
      const mask = columns({ audioMaskTransitionMs, timelineAudioInputs: [{ frame: 0, frames: plan.middleFrames }] });
      for (const seam of [start, end]) for (let i = Math.floor(seam - 1e-9); i <= Math.ceil(seam) - (Number.isInteger(seam) ? 0 : 1); i++) expect(mask[i]).toBe(1);
      expect(mask[Math.ceil(start) + 2]).toBe(0); expect(mask[Math.floor(end) - 3]).toBe(0);
    }
    // Without a reference there is no seam to regenerate.
    const graph = bridgeWorkflow('input', { ...base, mode: 'custom', before: 0, after: 0, timelineAudioInputs: [{ frame: 0, frames: 48 }] }, 1);
    expect(Object.keys(graph).filter(key => key.startsWith('audio_timeline_mask_')).map(key => graph[key].inputs.x)).toContain(0);
    expect(inputAudioMaskStrength(inputMaskCurve(undefined, 1, 1, 0, true), plan.prefixFrames, plan.prefixFrames, plan.middleFrames, plan.suffixFrames, [{ frame: 0, frames: 48 }])).toBe(1);
    expect(inputAudioMaskStrength(inputMaskCurve(undefined, 1, 1, 0, true), plan.prefixFrames + 4, plan.prefixFrames, plan.middleFrames, plan.suffixFrames, [{ frame: 0, frames: 48 }])).toBe(0);
  });
  it('treats input sound as a generation change and sound over the result as playback only', () => {
    const submitted = interstitialSettings(settings);
    const item = { ...submitted, id: 'clip', label: 'Clip', time: 0, phase: 'ready', generationSettings: submitted } as Interstitial;
    expect(hasUnsubmittedChanges({ ...item, generatedAudioTracks: [track([sound()])] })).toBe(false);
    expect(hasUnsubmittedChanges({ ...item, inputAudioTracks: [track([sound()])] })).toBe(true);
    expect(interstitialSettings({ ...settings, inputAudioTracks: [track([sound()])] }).inputAudioTracks).toHaveLength(1);
  });
  it('keeps both track lists and their files in portable archives', async () => {
    const input = [track([sound({ frame: -12 })], { name: 'Dialogue' })], generated = [track([sound({ assetId: music, name: 'Score.wav', volume: .4 })], { name: 'Score', muted: true })];
    const item = { ...interstitialSettings(settings), id: 'clip', label: 'Clip', time: 0, phase: 'draft', inputAudioTracks: input, generatedAudioTracks: generated } as Interstitial;
    const project: Project = { id: 'project', name: 'Sound', updatedAt: 1, source: { name: 'Empty' }, storyFlow: { version: 1, entryId: '', nodes: [], edges: [], templates: [] }, interstitials: [item], subtitle: null, analysis: emptyAnalysis() };
    const signal = new AbortController().signal;
    const archive = await packProject(project, [{ id: voice, name: 'Line.wav', blob: new Blob(['a'], { type: 'audio/wav' }) }, { id: music, name: 'Score.wav', blob: new Blob(['b'], { type: 'audio/wav' }) }], signal, () => {});
    const restored = await unpackProject(archive, signal, () => {});
    const remap = (id: string) => restored.assets[[voice, music].indexOf(id)].id;
    const saved = restored.project.interstitials[0];
    expect(saved.inputAudioTracks).toEqual(input.map(t => ({ ...t, clips: t.clips.map(c => ({ ...c, assetId: remap(c.assetId) })) })));
    expect(saved.generatedAudioTracks).toEqual(generated.map(t => ({ ...t, clips: t.clips.map(c => ({ ...c, assetId: remap(c.assetId) })) })));
    expect(assetIds(restored.project).sort()).toEqual(restored.assets.map(asset => asset.id).sort());
    expect(assetUsage(restored.project, [remap(voice), remap(music)])).toEqual([{ owner: 'Clip', role: 'input sound' }, { owner: 'Clip', role: 'sound over generated video' }]);
  });
});

describe('audio levels in the generation timeline', () => {
  const item = (patch: Partial<Interstitial> = {}) => ({ ...interstitialSettings(settings), id: 'clip', label: 'Clip', time: 0, phase: 'draft', ...patch }) as Interstitial;
  const project = (interstitials: Interstitial[]): Project => ({ id: 'project', name: 'Levels', updatedAt: 1, source: { name: 'Empty' }, storyFlow: { version: 1, entryId: '', nodes: [], edges: [], templates: [] }, interstitials, subtitle: null, analysis: emptyAnalysis() });
  it('stores full volume as absent and treats reference levels as generation inputs', () => {
    expect(interstitialSettings({ ...settings, startReferenceVolume: 1, endReferenceVolume: .25 })).toMatchObject({ endReferenceVolume: .25 });
    expect(interstitialSettings({ ...settings, startReferenceVolume: 1 })).not.toHaveProperty('startReferenceVolume');
    const submitted = item({ phase: 'ready', generationSettings: interstitialSettings(settings) });
    expect(hasUnsubmittedChanges({ ...submitted, startReferenceVolume: 1 })).toBe(false);
    expect(hasUnsubmittedChanges({ ...submitted, startReferenceVolume: .5 })).toBe(true);
    expect(hasUnsubmittedChanges({ ...submitted, timelineVideos: [{ id: 'v', frame: 0, enabled: true, volume: .5 }] })).toBe(true);
  });
  it('applies track level and mute to every sound', () => {
    const quiet = track([sound({ volume: .5 })], { volume: .5 });
    expect(audibleClips([quiet], 0, 100)[0].volume).toBe(.25);
    expect(audibleClips([{ ...quiet, muted: true }, track([sound()], { volume: 0 })], 0, 100)).toEqual([]);
  });
  it('undoes adding the first track and merges a volume drag into one step', () => {
    const history = new ProjectHistory(), empty = project([item()]), added = project([item({ inputAudioTracks: [track([sound()])] })]);
    history.record(empty, added, 1000);
    expect(history.target('undo')!.interstitials[0]).toMatchObject({ inputAudioTracks: [], generatedAudioTracks: [], startReferenceVolume: 1 });
    history.endGroup();
    const level = (volume: number) => project([item({ inputAudioTracks: [{ ...added.interstitials[0].inputAudioTracks![0], volume }] })]);
    history.record(added, level(.8), 2000); history.record(level(.8), level(.6), 2100); history.record(level(.6), level(.4), 2200);
    expect(history.undoLabel).toBe('Change volume');
    expect(history.target('undo')!.interstitials[0].inputAudioTracks?.[0].volume).toBeUndefined();
  });
  it('keeps every level in portable archives', async () => {
    const saved = item({ startReferenceVolume: .3, endReferenceVolume: 0, timelineVideos: [{ id: 'v', frame: 0, enabled: true, volume: .7 }],
      inputAudioTracks: [track([sound()], { volume: .6 })] });
    const signal = new AbortController().signal;
    const restored = await unpackProject(await packProject(project([saved]), [{ id: voice, name: 'Line.wav', blob: new Blob(['a'], { type: 'audio/wav' }) }], signal, () => {}), signal, () => {});
    expect(restored.project.interstitials[0]).toMatchObject({ startReferenceVolume: .3, endReferenceVolume: 0, timelineVideos: [{ volume: .7 }], inputAudioTracks: [{ volume: .6 }] });
  });
});

describe('sound over generated videos', () => {
  const full = crypto.randomUUID(), loop = crypto.randomUUID(), upscaled = crypto.randomUUID();
  const result: InterstitialResult = { url: `asset:${loop}`, assetId: loop, fullAssetId: full, fullRange: { start: 1.5, duration: 4, totalDuration: 7 }, upscaled: { assetId: upscaled, totalDuration: 7 }, start: 0, duration: 4, totalDuration: 4 };
  const clip = sound({ frame: -12, inFrame: 24, outFrame: 72 });
  const item = { ...interstitialSettings(settings), id: 'clip', label: 'Clip', time: 0, phase: 'ready', result, generatedAudioTracks: [track([clip]), track([sound()], { muted: true })] } as Interstitial;
  const layer = (assetId: string, time: number, patch: Partial<PlaybackLayer> = {}): PlaybackLayer => ({ key: `scene:${assetId}`, sourceFootage: false, source: { id: assetId, assetId, name: 'Clip', url: 'blob:x' }, time, opacity: 1, gain: .5, gainRate: -2, ...patch });
  it('maps every file of the render onto the generated section clock', () => {
    expect(generatedClipAudio([item])).toEqual({ [full]: { body: 1.5, tracks: [item.generatedAudioTracks![0]] }, [loop]: { body: 0, tracks: [item.generatedAudioTracks![0]] }, [upscaled]: { body: 1.5, tracks: [item.generatedAudioTracks![0]] } });
    expect(generatedClipAudio([{ ...item, generatedAudioTracks: [track([sound()], { muted: true })] }])).toEqual({});
  });
  it('plays a sound with its video layer’s position, fade and visit, and stops outside it', () => {
    const map = generatedClipAudio([item]);
    const url = vi.spyOn(assets, 'url').mockImplementation(id => id === voice ? 'blob:voice' : undefined);
    try {
      const [inFull] = clipAudioLayers([layer(full, 1.5)], map);
      expect(inFull).toMatchObject({ time: (24 + 12) / TIMELINE_FPS, end: 3, gain: .5, gainRate: -2, source: { assetId: voice, kind: 'audio', volume: 1 } });
      expect(inFull.key).toContain(`scene:${full}:sound:${clip.id}`);
      expect(clipAudioLayers([layer(loop, 0)], map)[0].time).toBeCloseTo(inFull.time);
      expect(clipAudioLayers([layer(upscaled, 1.5)], map)[0].time).toBeCloseTo(inFull.time);
      expect(clipAudioLayers([layer(full, 1.5 - 13 / TIMELINE_FPS)], map)).toEqual([]);
      expect(clipAudioLayers([layer(full, 1.5 + 36 / TIMELINE_FPS)], map)).toEqual([]);
      expect(clipAudioLayers([layer(full, 1.5, { muted: true }), layer(full, 1.5, { still: true })], map)).toEqual([]);
      const quiet = generatedClipAudio([{ ...item, generatedAudioTracks: [{ ...item.generatedAudioTracks![0], volume: .5 }] }]);
      expect(clipAudioLayers([layer(full, 1.5)], quiet)[0].source.volume).toBe(.5);
    } finally { url.mockRestore(); }
  });
});
