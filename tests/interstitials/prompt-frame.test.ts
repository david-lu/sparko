import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturePromptFrame } from '../../src/features/player/promptFrame';
import type { PlayerState } from '../../src/features/player/VideoPlayerController';

vi.mock('../../src/media/imagePreview', () => ({ imagePreview: vi.fn(async () => 'data:image/jpeg;base64,YQ==') }));
afterEach(() => vi.useRealTimers());
function player(buffering = true) {
  let state = { duration: 10, buffering, error: null } as PlayerState;
  const listeners = new Set<() => void>();
  const value = { getSnapshot: () => state, captureFrame: vi.fn(async () => new Blob()),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { value, listeners, update: (patch: Partial<PlayerState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); } };
}
describe('enhancement immediately after returning to the story player', () => {
  it.each(['data:image/jpeg;base64,Yg==', undefined])('uses the active preview, including its empty frame: %s', async frame => {
    const p = player(), capture = vi.fn(async () => frame), signal = new AbortController().signal;
    expect(await capturePromptFrame(p.value, signal, capture)).toBe(frame);
    expect(capture).toHaveBeenCalledWith(signal);
    expect(p.value.captureFrame).not.toHaveBeenCalled(); expect(p.listeners.size).toBe(0);
  });
  it('does not return an active-preview snapshot after cancellation', async () => {
    const p = player(false), operation = new AbortController();
    const capture = async () => { operation.abort(); return 'data:image/jpeg;base64,Yg=='; };
    await expect(capturePromptFrame(p.value, operation.signal, capture)).rejects.toMatchObject({ name: 'AbortError' });
    expect(p.value.captureFrame).not.toHaveBeenCalled();
  });
  it('waits for the restored frame and then captures without pausing the user', async () => {
    const p = player(), result = capturePromptFrame(p.value, new AbortController().signal);
    expect(p.value.captureFrame).not.toHaveBeenCalled(); expect(p.listeners.size).toBe(1);
    p.update({ buffering: false });
    expect(await result).toBe('data:image/jpeg;base64,YQ==');
    expect(p.value.captureFrame).toHaveBeenCalledWith({ pause: false }); expect(p.listeners.size).toBe(0);
  });
  it('captures an already-ready frame immediately', async () => {
    const p = player(false), result = capturePromptFrame(p.value, new AbortController().signal);
    expect(p.value.captureFrame).toHaveBeenCalledOnce(); await result; expect(p.listeners.size).toBe(0);
  });
  it('cancels the wait and removes its subscription without capturing', async () => {
    const p = player(), controller = new AbortController(), result = capturePromptFrame(p.value, controller.signal);
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejection;
    p.update({ buffering: false }); expect(p.value.captureFrame).not.toHaveBeenCalled(); expect(p.listeners.size).toBe(0);
  });
  it('reports a real decoding error and stops waiting', async () => {
    const p = player(), result = capturePromptFrame(p.value, new AbortController().signal);
    const rejection = expect(result).rejects.toThrow('Missing video'); p.update({ error: 'Missing video' }); await rejection;
    expect(p.value.captureFrame).not.toHaveBeenCalled(); expect(p.listeners.size).toBe(0);
  });
  it('bounds a stalled decode and cleans up its listener', async () => {
    vi.useFakeTimers(); const p = player(), result = capturePromptFrame(p.value, new AbortController().signal);
    const rejection = expect(result).rejects.toThrow('still loading'); await vi.advanceTimersByTimeAsync(15_000); await rejection;
    expect(p.listeners.size).toBe(0); expect(p.value.captureFrame).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not capture a project that closed while its frame was loading', async () => {
    const p = player(), result = capturePromptFrame(p.value, new AbortController().signal);
    p.update({ duration: 0, buffering: false }); expect(await result).toBeUndefined(); expect(p.value.captureFrame).not.toHaveBeenCalled();
  });
});
