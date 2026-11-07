import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enhancePrompt } from '../../src/features/interstitials/enhance-prompt';
import { sampleFrame } from '../../src/media/media';
import { request } from '../../src/shared/api';
import { assets } from '../../src/features/project/assets';
import type { MediaEngine } from '../../src/media/MediaEngine';
import type { Interstitial, GenerationReference } from '../../shared/interstitials';
import { imagePreview } from '../../src/media/imagePreview';
import type { PlayerState } from '../../src/features/player/VideoPlayerController';

vi.mock('../../src/media/media', () => ({ sampleFrame: vi.fn() }));
vi.mock('../../src/shared/api', () => ({ request: vi.fn() }));
vi.mock('../../src/features/project/assets', () => ({ assets: { open: vi.fn() } }));
vi.mock('../../src/media/imagePreview', () => ({ imagePreview: vi.fn() }));
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
