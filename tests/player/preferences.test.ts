import { afterEach, expect, it, vi } from 'vitest';
import { savedCrossfadeFrames } from '../../src/features/player/preferences';

afterEach(() => vi.unstubAllGlobals());

it.each([[null, 4], ['invalid', 4], ['Infinity', 4], ['0', 4], ['-10', 4], ['12', 12], ['13', 14], ['500', 48]])(
  'restores crossfade frames from %s with safe defaults and limits', (stored, frames) => {
    vi.stubGlobal('localStorage', { getItem: () => stored });
    expect(savedCrossfadeFrames()).toBe(frames);
  });

it('uses the default length when storage is unavailable', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Storage unavailable'); } });
  expect(savedCrossfadeFrames()).toBe(4);
});
