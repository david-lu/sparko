import { afterEach, expect, it, vi } from 'vitest';
import { inspectAsset } from '../../src/features/project/libraryFiles';
import { MediaEngine } from '../../src/media/MediaEngine';
import { inspectMedia } from '../../src/media/media';

vi.mock('../../src/media/media', () => ({ inspectMedia: vi.fn(), exportMp4: vi.fn(), extractAudio: vi.fn(), sampleFrames: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('releases media elements, object URLs, and timeouts immediately on cancellation', async () => {
  vi.useFakeTimers();
  const element = { onloadedmetadata: null, onerror: null, removeAttribute: vi.fn(), load: vi.fn(), preload: '', src: '' };
  vi.stubGlobal('document', { createElement: vi.fn(() => element) });
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const controller = new AbortController(), pending = inspectAsset(new Blob(['audio']), 'audio', controller.signal);
  const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await assertion;
  expect(element.removeAttribute).toHaveBeenCalledWith('src'); expect(element.load).toHaveBeenCalledOnce();
  expect(element.onloadedmetadata).toBeNull(); expect(element.onerror).toBeNull(); expect(revoke).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('does not create decoding resources for an already-cancelled inspection', async () => {
  const createElement = vi.fn(); vi.stubGlobal('document', { createElement });
  await expect(inspectAsset(new Blob(['video']), 'video', AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
  expect(createElement).not.toHaveBeenCalled();
});
it('closes a bitmap that finishes decoding after cancellation', async () => {
  let finish!: (image: { width: number; height: number; close: () => void }) => void;
  vi.stubGlobal('createImageBitmap', () => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController(), pending = inspectAsset(new Blob(['image']), 'image', controller.signal);
  const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' }), close = vi.fn();
  controller.abort(); finish({ width: 10, height: 10, close }); await assertion; expect(close).toHaveBeenCalledOnce();
});
it('retries failed metadata and aborts an in-flight inspection when the engine is disposed', async () => {
  vi.mocked(inspectMedia).mockRejectedValueOnce(new Error('Temporary failure')).mockImplementationOnce((_source, signal) => new Promise((_resolve, reject) => {
    signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
  }));
  const engine = new MediaEngine({ id: 'video', name: 'Video', url: 'blob:video' });
  await expect(engine.inspect()).rejects.toThrow('Temporary failure');
  const pending = engine.inspect(), assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  engine.dispose(); await assertion;
});
