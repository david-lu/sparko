import { afterEach, expect, it, vi } from 'vitest';
import { savedCrossfadeFrames } from '../../src/features/player/preferences';

afterEach(() => vi.unstubAllGlobals());

it.each([[null, 14], ['invalid', 14], ['Infinity', 14], ['0', 14], ['-10', 14], ['4', 14], ['12', 12], ['14', 14], ['13', 14], ['500', 48]])(
  'restores crossfade frames from %s with safe defaults and limits', (stored, frames) => {
    vi.stubGlobal('localStorage', { getItem: () => stored });
    expect(savedCrossfadeFrames()).toBe(frames);
  });

it('uses the default length when storage is unavailable', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Storage unavailable'); } });
  expect(savedCrossfadeFrames()).toBe(14);
});
