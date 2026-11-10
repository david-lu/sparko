import { describe, expect, it } from 'vitest';
import type { InterstitialSettings } from '../../shared/interstitials';
import { createGenerationPreview, generationPreviewReducer as reduce, previewFrames, generationInputAtFrame, generationEndpointImages, previewFrameAtPoint, previewKeyboardFrame, type GenerationPreviewAction } from '../../src/features/interstitials/generation-preview';
import { generationTimelineSegments } from '../../src/features/interstitials/generation-timeline';

const initial = () => createGenerationPreview(226, 113, 'saved.mp4', 96);
const apply = (...actions: GenerationPreviewAction[]) => actions.reduce(reduce, initial());

describe('generation preview transport', () => {
  it('shows the 2K video in its own Upscaled tab on the shared clock', () => {
    expect(reduce(initial(), { type: 'mode', mode: 'upscaled' })).toMatchObject({ mode: 'input' });
    let state = reduce(initial(), { type: 'configure', inputFrames: 226, generatedUrl: 'saved.mp4', generatedFrames: 96, upscaledUrl: '2k.mp4', upscaledFrames: 96 });
    state = reduce(reduce(state, { type: 'mode', mode: 'upscaled' }), { type: 'seek', frame: 40 });
    expect(state).toMatchObject({ mode: 'upscaled', frame: 40, generated: { url: 'saved.mp4' }, upscaled: { url: '2k.mp4', frames: 96 } });
    // Each tab keeps its own measured length; the playhead stays put across tabs.
    state = reduce(state, { type: 'metadata', url: '2k.mp4', frames: 95 });
    expect(previewFrames(state)).toBe(95); expect(reduce(state, { type: 'mode', mode: 'generated' })).toMatchObject({ frame: 40, generated: { frames: 96 } });
    // A replacement render has no 2K video yet, so the Upscaled tab falls back to Input.
    expect(reduce(state, { type: 'configure', inputFrames: 226, generatedUrl: 'new.mp4', generatedFrames: 96 })).toMatchObject({ mode: 'input', upscaled: undefined });
  });
  it('starts paused in Input even when a saved result exists', () => {
    expect(initial()).toMatchObject({ mode: 'input', frame: 113, playing: false });
    expect(previewFrames(initial())).toBe(226);
  });
  it.each(['input', 'generated'] as const)('scrubbing every frame preserves %s mode', mode => {
    let state = reduce(initial(), { type: 'mode', mode });
    for (let frame = 0; frame < previewFrames(state); frame++) {
      state = reduce(state, { type: 'seek', frame });
      expect(state).toMatchObject({ mode, frame, playing: false });
    }
  });
  it('plays from zero, stops at the last frame, and restarts from zero', () => {
    let state = apply({ type: 'seek', frame: 0 }, { type: 'toggle' }, { type: 'tick', frame: 7 });
    expect(state).toMatchObject({ frame: 7, playing: true, mode: 'input' });
    state = reduce(state, { type: 'tick', frame: 999 });
    expect(state).toMatchObject({ frame: 225, playing: false });
    expect(reduce(state, { type: 'toggle' })).toMatchObject({ frame: 0, playing: true });
  });
  it.each(['pause', 'seek', 'mode'] as const)('ignores a queued playback tick after %s', type => {
    const action: GenerationPreviewAction = type === 'seek' ? { type, frame: 40 } : type === 'mode' ? { type, mode: 'generated' } : { type };
    const state = apply({ type: 'toggle' }, action);
    expect(reduce(state, { type: 'tick', frame: 180 })).toBe(state);
  });
  it('does not let an obsolete clock move backwards or inject NaN', () => {
    const state = apply({ type: 'toggle' });
    expect(reduce(state, { type: 'tick', frame: 1 })).toBe(state);
    expect(reduce(state, { type: 'tick', frame: NaN })).toBe(state);
  });
  it('mode changes pause and clamp to that source’s own duration', () => {
    const generated = apply({ type: 'toggle' }, { type: 'mode', mode: 'generated' });
    expect(generated).toMatchObject({ mode: 'generated', frame: 95, playing: false });
    expect(previewFrames(generated)).toBe(96);
    expect(reduce(generated, { type: 'mode', mode: 'input' })).toMatchObject({ frame: 95, playing: false });
  });
  it('inspecting an input explicitly returns to Input at the requested frame', () => {
    expect(apply({ type: 'mode', mode: 'generated' }, { type: 'inspect-input', frame: 200 })).toMatchObject({ mode: 'input', frame: 200, playing: false });
  });
  it('cannot enter Generated without a saved result', () => {
    const state = createGenerationPreview(10);
    expect(reduce(state, { type: 'mode', mode: 'generated' })).toBe(state);
  });
  it('duration edits pause playback and clamp the input position', () => {
    expect(apply({ type: 'toggle' }, { type: 'configure', inputFrames: 24, generatedUrl: 'saved.mp4', generatedFrames: 96 })).toMatchObject({ frame: 23, playing: false, inputFrames: 24 });
  });
  it('removing a saved result returns to Input and clamps safely', () => {
    expect(apply({ type: 'mode', mode: 'generated' }, { type: 'toggle' }, { type: 'configure', inputFrames: 10 })).toMatchObject({ mode: 'input', frame: 0, playing: false, generated: undefined });
  });
  it('metadata controls every generated seek boundary, including results longer than the draft', () => {
    const state = apply({ type: 'metadata', url: 'saved.mp4', frames: 400 }, { type: 'mode', mode: 'generated' }, { type: 'seek', frame: 399 });
    expect(previewFrames(state)).toBe(400); expect(state.frame).toBe(399);
    expect(reduce(state, { type: 'mode', mode: 'input' }).frame).toBe(225);
  });
  it('late metadata from an old result cannot change the current render duration', () => {
    const state = apply({ type: 'configure', inputFrames: 226, generatedUrl: 'new.mp4', generatedFrames: 200 });
    expect(reduce(state, { type: 'metadata', url: 'saved.mp4', frames: 10 })).toBe(state);
  });
  it.each([NaN, Infinity, 0, -1])('ignores invalid generated metadata %s', frames => {
    const state = initial(); expect(reduce(state, { type: 'metadata', url: 'saved.mp4', frames })).toBe(state);
  });
  it('retains measured result duration when input settings change or estimates are repeated', () => {
    const state = apply({ type: 'metadata', url: 'saved.mp4', frames: 100 });
    expect(reduce(state, { type: 'configure', inputFrames: 226, generatedUrl: 'saved.mp4', generatedFrames: 96 })).toBe(state);
    expect(reduce(state, { type: 'configure', inputFrames: 400, generatedUrl: 'saved.mp4' }).generated?.frames).toBe(100);
  });
  it('handles a single-frame preview without negative positions or endless playback', () => {
    const state = reduce(createGenerationPreview(1, 99), { type: 'toggle' });
    expect(reduce(state, { type: 'tick', frame: 1 })).toMatchObject({ frame: 0, playing: false });
  });
  it.each([-100, NaN, Infinity, 1.4, 999])('clamps requested seek %s to a valid integer frame', frame => {
    const state = reduce(initial(), { type: 'seek', frame });
    expect(Number.isInteger(state.frame)).toBe(true); expect(state.frame).toBeGreaterThanOrEqual(0); expect(state.frame).toBeLessThan(226);
  });
});

const settings = (): InterstitialSettings => ({ duration: 4, start_range: 1, end_range: 1, prompt: '', enable_prompt_expansion: false, useInputReference: true, useOutputReference: true });
const segment = generationTimelineSegments({ before: { sceneId: 'a', assetId: 'start', inFrame: 24, outFrame: 48 }, after: { sceneId: 'b', assetId: 'end', inFrame: 48, outFrame: 72 } }, 24, 96, 24);
const input = (frame: number, item = settings()) => generationInputAtFrame(item, segment, frame, 24, 96, 144);

describe('input frame resolution', () => {
  it.each([24, 25, 60, 119])('shows black in the unfilled generated interval at frame %s', frame => {
    expect(input(frame)).toBeUndefined();
  });
  it('uses source trims and half-open start/end reference intervals', () => {
    expect(input(0)).toMatchObject({ assetId: 'start', sourceFrame: 24 });
    expect(input(23)).toMatchObject({ assetId: 'start', sourceFrame: 47 });
    expect(input(24)).toBeUndefined();
    expect(input(120)).toMatchObject({ assetId: 'end', sourceFrame: 48 });
    expect(input(143)).toMatchObject({ assetId: 'end', sourceFrame: 71 });
  });
  it.each([-1, 144, NaN, 2.5])('does not invent footage for invalid frame %s', frame => { expect(input(frame)).toBeUndefined(); });
  it('shows black for unresolved reference slots', () => {
    expect(generationInputAtFrame(settings(), generationTimelineSegments(undefined, 24, 96, 24), 0, 24, 96, 144)).toBeUndefined();
  });
  it('holds a loop’s last reference frame for its whole suffix', () => {
    const segments = generationTimelineSegments({ mode: 'loop', before: { sceneId: 'a', assetId: 'loop', inFrame: 12, outFrame: 36 } }, 24, 96, 24);
    for (const frame of [120, 130, 143]) expect(generationInputAtFrame(settings(), segments, frame, 24, 96, 144)).toMatchObject({ assetId: 'loop', sourceFrame: 35, held: true });
  });
  it('previews a trimmed inserted video only inside its interval', () => {
    const item = { ...settings(), timelineVideos: [{ id: 'v', enabled: true, frame: 20, video: { assetId: 'video', name: 'Video', inFrame: 50, outFrame: 74 } }] };
    expect(input(43, item)).toBeUndefined();
    expect(input(44, item)).toMatchObject({ assetId: 'video', sourceFrame: 50 });
    expect(input(67, item)).toMatchObject({ assetId: 'video', sourceFrame: 73 });
    expect(input(68, item)).toBeUndefined();
    item.timelineVideos[0].enabled = false; expect(input(44, item)).toBeUndefined();
  });
  it.each(['guide', 'frame'] as const)('shows a %s image at exactly one frame over an inserted video', method => {
    const item = { ...settings(), keyframes: [{ id: 'k', frame: 20, enabled: true, method, image: { assetId: 'image', name: 'Image' } }], timelineVideos: [{ id: 'v', frame: 0, enabled: true, video: { assetId: 'video', name: 'Video', inFrame: 0, outFrame: 96 } }] };
    expect(input(43, item)?.assetId).toBe('video'); expect(input(44, item)).toMatchObject({ assetId: 'image', sourceFrame: 0 }); expect(input(45, item)?.assetId).toBe('video');
    item.keyframes[0].enabled = false; expect(input(44, item)?.assetId).toBe('video');
  });
  it('does not let invalid keyframes or videos overwrite the end reference', () => {
    const item = { ...settings(), keyframes: [{ id: 'k', frame: 96, enabled: true, image: { assetId: 'image', name: 'Image' } }], timelineVideos: [{ id: 'v', frame: 90, enabled: true, video: { assetId: 'video', name: 'Video', inFrame: 0, outFrame: 50 } }] };
    expect(input(120, item)?.assetId).toBe('end');
  });
  it('endpoint images honor their video toggles, frame positions, and enabled flags', () => {
    const item = { ...settings(), startImageIndex: 0, endImageIndex: 0, imageReferences: [{ assetId: 'image', name: 'Image', enabled: true }] };
    expect(generationEndpointImages(item, 144)).toEqual([]);
    item.useInputReference = item.useOutputReference = false;
    expect(generationEndpointImages(item, 144).map(i => i.frame)).toEqual([0, 143]);
    expect(input(0, item)?.assetId).toBe('image'); expect(input(143, item)?.assetId).toBe('image');
    item.imageReferences[0].enabled = false; expect(generationEndpointImages(item, 144)).toEqual([]);
  });
});

describe('timeline pointer and keyboard coordinates', () => {
  it('accounts for scroll and zoom using the full track rectangle', () => {
    expect(previewFrameAtPoint(100, -400, 1000, 240)).toBe(120);
  });
  it.each([[0, 0], [100, 0], [150, 50], [200, 99], [300, 99]])('clamps pointer x=%s to frame %s', (x, frame) => { expect(previewFrameAtPoint(x, 100, 100, 100)).toBe(frame); });
  it.each([0, NaN, Infinity, -10])('keeps the playhead when track width %s is unavailable', width => { expect(previewFrameAtPoint(100, 0, width, 240, 50)).toBe(50); });
  it.each([
    ['Home', false, 50, 0], ['End', false, 0, 99], ['ArrowRight', false, 50, 51], ['ArrowLeft', false, 50, 49],
    ['ArrowRight', true, 50, 60], ['ArrowLeft', true, 50, 40], ['ArrowRight', true, 95, 99], ['ArrowLeft', true, 5, 0],
  ] as const)('%s (shift=%s) moves frame %s to %s', (key, shift, frame, expected) => { expect(previewKeyboardFrame(key, shift, frame, 100)).toBe(expected); });
  it('leaves unrelated keyboard shortcuts alone', () => { expect(previewKeyboardFrame('Delete', false, 50, 100)).toBeUndefined(); });
});
