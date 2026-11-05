import { describe, expect, it, vi } from 'vitest';
import { generationSource } from '../../src/features/call-response/generation';
import { createNode } from '../../src/features/story-flow/model';
import { renderComposition } from '../../src/media/CompositionRenderer';
import { assets } from '../../src/features/project/assets';

vi.mock('../../src/features/project/assets', () => ({ assets: { open: vi.fn(async () => ({ url: 'blob:incoming', asset: { name: 'Reference.mp4', blob: new Blob([], { type: 'video/mp4' }) } })) } }));
vi.mock('../../src/media/MediaEngine', () => ({ MediaEngine: class {
  inspect() { return Promise.resolve({ duration: 10, fps: 24, width: 320, height: 192, hasAudio: false }); }
  dispose() {}
} }));
vi.mock('../../src/media/CompositionRenderer', () => ({ renderComposition: vi.fn(async () => {}) }));

describe('loop reference footage', () => {
  it('holds the incoming clip’s final frame as the return reference even if a different ending was supplied', async () => {
    const { item } = createNode('looped'); item.start_range = 2; item.end_range = 4;
    const prepared = await generationSource(item, { mode: 'loop',
      before: { sceneId: 'incoming', assetId: 'incoming-asset', inFrame: 24, outFrame: 240 },
      after: { sceneId: 'outgoing', assetId: 'outgoing-asset', inFrame: 0, outFrame: 120 },
    }, new AbortController().signal);
    await prepared.engine.exportMp4({ start: 0, end: 4 });
    const composition = vi.mocked(renderComposition).mock.calls[0][0];
    expect(assets.open).toHaveBeenCalledExactlyOnceWith('incoming-asset');
    expect(composition.segments).toMatchObject([
      { source: { id: 'incoming-asset' }, sourceStart: 8, startFrame: 0, endFrame: 48 },
      { source: { id: 'incoming-asset' }, sourceStart: 239 / 24, startFrame: 48, endFrame: 96, still: true },
    ]);
  });
});
