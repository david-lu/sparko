import { afterEach, expect, it, vi } from 'vitest';
import { savedCrossfadeFrames } from '../../src/features/player/preferences';

afterEach(() => vi.unstubAllGlobals());

it.each([[null, 12], ['invalid', 12], ['Infinity', 12], ['0', 12], ['-10', 12], ['4', 12], ['14', 14], ['13', 14], ['500', 48]])(
  'restores crossfade frames from %s with safe defaults and limits', (stored, frames) => {
    vi.stubGlobal('localStorage', { getItem: () => stored });
    expect(savedCrossfadeFrames()).toBe(frames);
  });

it('uses the default length when storage is unavailable', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Storage unavailable'); } });
  expect(savedCrossfadeFrames()).toBe(12);
});
