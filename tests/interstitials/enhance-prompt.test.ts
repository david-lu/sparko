import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enhancePrompt } from '../../src/features/interstitials/enhance-prompt';
import { sampleFrame } from '../../src/media/media';
import { request } from '../../src/shared/api';
import { assets } from '../../src/features/project/assets';
import type { MediaEngine } from '../../src/media/MediaEngine';
import type { Interstitial, GenerationReference } from '../../shared/interstitials';

vi.mock('../../src/media/media', () => ({ sampleFrame: vi.fn() }));
vi.mock('../../src/shared/api', () => ({ request: vi.fn() }));
vi.mock('../../src/features/project/assets', () => ({ assets: { open: vi.fn() } }));
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
});
const body = () => JSON.parse(vi.mocked(request).mock.calls[0][1]!.body as string);

describe('prompt enhancement references', () => {
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
