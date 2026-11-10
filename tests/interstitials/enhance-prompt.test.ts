import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enhancePrompt } from '../../src/features/interstitials/enhance-prompt';
import { sampleFrame } from '../../src/media/media';
import { request } from '../../src/shared/api';
import { assets } from '../../src/features/project/assets';
import type { MediaEngine } from '../../src/media/MediaEngine';
import type { Interstitial, GenerationReference } from '../../shared/interstitials';
import { imagePreview } from '../../src/media/imagePreview';
import type { PlayerState } from '../../src/features/player/VideoPlayerController';
import { analyzePromptReferences } from '../../src/features/interstitials/analyze-prompt-references';

vi.mock('../../src/media/media', () => ({ sampleFrame: vi.fn() }));
vi.mock('../../src/shared/api', () => ({ request: vi.fn() }));
vi.mock('../../src/features/project/assets', () => ({ assets: { open: vi.fn() } }));
vi.mock('../../src/media/imagePreview', () => ({ imagePreview: vi.fn() }));
vi.mock('../../src/features/interstitials/analyze-prompt-references', () => ({ analyzePromptReferences: vi.fn() }));
const item: Interstitial = { id: 'clip', label: 'Untitled', time: 5, prompt: 'A small gesture', duration: 6,
  start_range: 2, end_range: 2, enable_prompt_expansion: false, phase: 'draft' };
const reference: GenerationReference = { before: { sceneId: 'wait', assetId: 'idle-media', inFrame: 24, outFrame: 120 },
  after: { sceneId: 'continue', assetId: 'source-media', inFrame: 240, outFrame: 360 } };
const info = { duration: 20, fps: 24, width: 960, height: 544, hasAudio: true, codec: 'avc' };
const engine = { source: { id: 'source', name: 'Source', url: 'blob:source' } } as MediaEngine;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sampleFrame).mockResolvedValue({ time: 0, url: 'data:image/jpeg;base64,YQ==' });
  vi.mocked(assets.open).mockImplementation(async id => ({ asset: { id, name: id, blob: new Blob() }, url: `blob:${id}` }));
  vi.mocked(request).mockResolvedValue({ prompt: 'Enhanced', model: 'test-model' });
  vi.mocked(imagePreview).mockResolvedValue('data:image/jpeg;base64,Yw==');
});
const body = () => JSON.parse(vi.mocked(request).mock.calls[0][1]!.body as string);

describe('prompt enhancement references', () => {
  it('sends active timed images with body-relative frames and keeps them separate from Picture references', async () => {
    const keyframes = [{ id: 'pose', frame: 48, enabled: true, image: { assetId: '11111111-1111-4111-8111-111111111111', name: 'Pose' } }, { id: 'ignored', frame: 99, enabled: false }];
    await enhancePrompt({ ...item, keyframes }, 'response', reference, engine, info, new AbortController().signal);
    expect(body().keyframes).toEqual([{ frame: 48, image: 'data:image/jpeg;base64,Yw==' }]);
    expect(body().imageReferences).toEqual([]);
    expect(body().referenceTiming).toEqual({ prefixFrames: 39, suffixFrames: 39 });
  });
  it.each([undefined, 'Make the question brighter.'])('analyzes current reference footage only when opted in: %s', async editInstructions => {
    const descriptions = [{ side: 'start' as const, frames: 39, description: '0–1.625s: She lowers a bowl and closes her mouth.' }];
    vi.mocked(analyzePromptReferences).mockResolvedValue(descriptions);
    const onAnalyzing = vi.fn();
    await enhancePrompt({ ...item, analyzeReferences: true }, 'response', reference, engine, info, new AbortController().signal, { editInstructions, onAnalyzing });
    expect(body().referenceDescriptions).toEqual(descriptions);
    expect(onAnalyzing.mock.calls).toEqual([[true], [false]]);
    expect(analyzePromptReferences).toHaveBeenCalledOnce();
  });
  it('skips reference analysis when off, for pictures only, and for shared briefs', async () => {
    for (const selected of [item, { ...item, analyzeReferences: true, useInputReference: false, useOutputReference: false }]) {
      await enhancePrompt(selected, 'response', reference, engine, info, new AbortController().signal);
    }
    await enhancePrompt({ ...item, analyzeReferences: true }, 'response', reference, engine, info, new AbortController().signal, { target: 'continuity' });
    expect(analyzePromptReferences).not.toHaveBeenCalled();
  });
  it('does not enhance with missing analysis when the opted-in step fails', async () => {
    vi.mocked(analyzePromptReferences).mockRejectedValueOnce(new Error('Analysis failed'));
    const onAnalyzing = vi.fn();
    await expect(enhancePrompt({ ...item, analyzeReferences: true }, 'response', reference, engine, info, new AbortController().signal, { onAnalyzing })).rejects.toThrow('Analysis failed');
    expect(request).not.toHaveBeenCalled();
    expect(onAnalyzing.mock.calls).toEqual([[true], [false]]);
  });
  it.each([undefined, 'Keep the same words but make the delivery excited.'])('sends exact reference timing for enhancement and editing: %s', async editInstructions => {
    await enhancePrompt(item, 'response', reference, engine, info, new AbortController().signal, { editInstructions });
    expect(body()).toMatchObject({ duration: 6, referenceTiming: { prefixFrames: 39, suffixFrames: 39 } });
  });
  it.each([
    { useInputReference: true, useOutputReference: false, expected: { prefixFrames: 39, suffixFrames: 0 } },
    { useInputReference: false, useOutputReference: true, expected: { prefixFrames: 0, suffixFrames: 39 } },
    { useInputReference: false, useOutputReference: false, expected: { prefixFrames: 0, suffixFrames: 0 } },
  ])('uses only enabled footage: $useInputReference / $useOutputReference', async ({ expected, ...settings }) => {
    await enhancePrompt({ ...item, ...settings }, 'response', reference, engine, info, new AbortController().signal);
    expect(body().referenceTiming).toEqual(expected);
  });
  it('includes the duration of a reference sequence, including held images, and repeats a loop boundary', async () => {
    const still = { sceneId: 'still', assetId: 'image', kind: 'image' as const, inFrame: 0, outFrame: 24 };
    const video = { ...reference.before!, inFrame: 0, outFrame: 72 };
    await enhancePrompt({ ...item, start_range: 4, end_range: 4, method: 'comfy-loop' }, 'idle', { before: video, beforeClips: [still, video], mode: 'loop' }, engine, info, new AbortController().signal);
    expect(body().referenceTiming).toEqual({ prefixFrames: 90, suffixFrames: 90 });
  });
  it('assigns no duration to a reference picture and omits clip timing from a shared continuity brief', async () => {
    const selected = { ...item, useInputReference: false, useOutputReference: false, startImageIndex: 0 };
    await enhancePrompt(selected, 'interstitial', undefined, null, null, new AbortController().signal);
    expect(body().referenceTiming).toEqual({ prefixFrames: 0, suffixFrames: 0 });
    vi.mocked(request).mockClear();
    await enhancePrompt(item, 'call', reference, engine, info, new AbortController().signal, { target: 'continuity' });
    expect(body()).not.toHaveProperty('referenceTiming');
  });
  it('captures the current player before reading boundaries and keeps it separate from references', async () => {
    const frame = new Blob(['current frame'], { type: 'image/png' });
    const player = { getSnapshot: () => ({ duration: 20 } as PlayerState), captureFrame: vi.fn(async () => frame) };
    const signal = new AbortController().signal;
    const result = enhancePrompt(item, 'response', reference, engine, info, signal, { player });
    expect(player.captureFrame).toHaveBeenCalledWith({ pause: false });
    expect(sampleFrame).not.toHaveBeenCalled();
    await result;
    expect(imagePreview).toHaveBeenCalledWith(frame, signal);
    expect(body()).toMatchObject({ currentFrame: 'data:image/jpeg;base64,Yw==', referenceFrames: ['data:image/jpeg;base64,YQ==', 'data:image/jpeg;base64,YQ=='], imageReferences: [] });
  });
  it('allows enhancement without a current frame in an empty project', async () => {
    const player = { getSnapshot: () => ({ duration: 0 } as PlayerState), captureFrame: vi.fn() };
    await enhancePrompt(item, 'interstitial', undefined, null, null, new AbortController().signal, { player });
    expect(player.captureFrame).not.toHaveBeenCalled();
    expect(body()).not.toHaveProperty('currentFrame');
  });
  it('does not encode or submit a frame after capture is cancelled', async () => {
    const operation = new AbortController();
    const player = { getSnapshot: () => ({ duration: 20 } as PlayerState), captureFrame: vi.fn(async () => { operation.abort(); return new Blob(); }) };
    await expect(enhancePrompt(item, 'response', reference, engine, info, operation.signal, { player })).rejects.toMatchObject({ name: 'AbortError' });
    expect(imagePreview).not.toHaveBeenCalled();
    expect(sampleFrame).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it('sends LoRA instructions as separate enhancement context without changing the draft', async () => {
    await enhancePrompt({ ...item, loraInstructions: 'Use Sema in the prompt.' }, 'interstitial', undefined, null, null, new AbortController().signal);
    expect(body()).toMatchObject({ prompt: item.prompt, loraInstructions: 'Use Sema in the prompt.' });
  });
  it('sends project enhance instructions as separate context without changing the draft', async () => {
    await enhancePrompt(item, 'interstitial', undefined, null, null, new AbortController().signal, { projectInstructions: 'Keep a handheld feel.' });
    expect(body()).toMatchObject({ prompt: item.prompt, projectInstructions: 'Keep a handheld feel.' });
    await enhancePrompt(item, 'interstitial', undefined, null, null, new AbortController().signal);
    expect(JSON.parse(vi.mocked(request).mock.calls.at(-1)![1]!.body as string)).not.toHaveProperty('projectInstructions');
  });
  it('anchors a response to the last Idle frame and the first continuation frame', async () => {
    const signal = new AbortController().signal;
    await enhancePrompt(item, 'response', reference, engine, info, signal);
    expect(sampleFrame).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'idle-media' }), 119 / 24, 512, signal);
    expect(sampleFrame).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'source-media' }), 10, 512, signal);
    expect(body()).toMatchObject({ kind: 'response', prompt: item.prompt, duration: 6, referenceFrames: ['data:image/jpeg;base64,YQ==', 'data:image/jpeg;base64,YQ=='] });
    expect(JSON.stringify(body())).not.toContain('blob:');
  });
  it('uses the preceding clip as the Idle visual anchor', async () => {
    await enhancePrompt(item, 'idle', { before: reference.before }, engine, info, new AbortController().signal);
    expect(sampleFrame).toHaveBeenCalledOnce();
    expect(body()).toMatchObject({ kind: 'idle', referenceFrames: ['data:image/jpeg;base64,YQ=='] });
  });
  it('samples the source frames immediately before and after an ordinary insertion', async () => {
    await enhancePrompt(item, 'interstitial', undefined, engine, info, new AbortController().signal);
    expect(vi.mocked(sampleFrame).mock.calls.map(call => call[1])).toEqual([5 - 1 / 24, 5]);
    expect(assets.open).not.toHaveBeenCalled();
  });
  it('does not contact OpenAI after reference sampling is cancelled', async () => {
    const operation = new AbortController();
    vi.mocked(sampleFrame).mockImplementationOnce(async () => { operation.abort(); return { time: 0, url: 'data:image/jpeg;base64,YQ==' }; });
    await expect(enhancePrompt(item, 'idle', { before: reference.before }, engine, info, operation.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).not.toHaveBeenCalled();
  });
});


it('edits and restores Picture numbering in both prompts, while Enhance reads only the original', async () => {
  const selected = { ...item, prompt: 'Wave like <Picture 2>.', enhancedPrompt: '[Shot 1] Wave like <Picture 2>, holding the pose.', imageReferences: [
    { assetId: '11111111-1111-4111-8111-111111111111', name: 'Off', enabled: false },
    { assetId: '22222222-2222-4222-8222-222222222222', name: 'Pose' },
  ] };
  vi.mocked(request).mockResolvedValue({ prompt: 'Smile like <Picture 1>.', enhancedPrompt: '[Shot 1] Smile like <Picture 1>, holding the pose.', model: 'test' });
  const result = await enhancePrompt(selected, 'interstitial', undefined, null, null, new AbortController().signal, { editInstructions: 'Smile instead.' });
  expect(body()).toMatchObject({ prompt: 'Wave like <Picture 1>.', enhancedPrompt: '[Shot 1] Wave like <Picture 1>, holding the pose.' });
  expect(result).toMatchObject({ prompt: 'Smile like <Picture 2>.', enhancedPrompt: '[Shot 1] Smile like <Picture 2>, holding the pose.' });
  vi.mocked(request).mockClear();
  await enhancePrompt(selected, 'interstitial', undefined, null, null, new AbortController().signal);
  expect(body()).not.toHaveProperty('enhancedPrompt');
});
