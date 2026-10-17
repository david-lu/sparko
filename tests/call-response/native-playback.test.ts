import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowPlayback } from '../../src/features/call-response/FlowPlayback';
import { createTestFlow } from '../../src/features/call-response/model';

afterEach(() => vi.unstubAllGlobals());

describe('flow playback fallback', () => {
  it('keeps native scene playback and source time when MediaSource is unavailable', async () => {
    vi.stubGlobal('MediaSource', undefined);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    class Video extends EventTarget {
      src = 'blob:source'; readyState = 2; loop = false; private position = 0;
      get currentTime() { return this.position; }
      set currentTime(value: number) { this.position = value; queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); }
      play = vi.fn(async () => undefined);
      pause = vi.fn(); load = vi.fn();
    }
    const video = new Video(), changed = vi.fn();
    const player = new FlowPlayback(createTestFlow(), video as unknown as HTMLVideoElement,
      { id: 'original', assetId: 'mock:original', name: 'Original', url: 'blob:source' }, changed);
    expect(player.diagnostics).toBeUndefined();
    player.play(); expect(video.play).toHaveBeenCalled();
    player.seekScene('intro', 12); await Promise.resolve();
    expect(video.currentTime).toBe(.5); expect(player.sourceTime).toBe(.5);
    expect(player.session).toMatchObject({ sceneId: 'intro', frame: 12, playing: false });
    expect(changed.mock.calls.at(-1)?.[1]).toBe(false);
    player.dispose();
  });
});
