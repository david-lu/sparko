import { describe, expect, it } from 'vitest';
import { linkGeometry } from '../../src/features/story-flow/links';

describe('direct connection routing', () => {
  it('keeps overlapping sockets on the same row instead of taking a large detour', () => {
    const link = linkGeometry({ x: 110, y: 80 }, { x: 100, y: 80 });
    expect(link.path).toBe('M110,80 L100,80');
    expect(link.middle).toEqual({ x: 105, y: 80 });
  });
  it('finds the correct segment for a new point on a backward routed connection', () => {
    const link = linkGeometry({ x: 100, y: 0 }, { x: 0, y: 100 }, [{ x: 100, y: 100 }]);
    expect(link.insertionIndex({ x: 105, y: 30 })).toBe(0);
    expect(link.insertionIndex({ x: 20, y: 105 })).toBe(1);
    expect(link.insertionIndex({ x: -50, y: 105 })).toBe(1);
  });
  it('handles coincident sockets and duplicate route points without invalid coordinates', () => {
    const point = { x: 20, y: 30 }, link = linkGeometry(point, point, [point]);
    expect(link.middle).toEqual(point);
    expect(link.insertionIndex(point)).toBe(0);
    expect(link.path).not.toMatch(/NaN|Infinity/);
  });
  it('keeps an actual connection back to the same clip visible above it', () => {
    const link = linkGeometry({ x: 100, y: 100 }, { x: 0, y: 100 }, [], true);
    expect(link.middle.y).toBeLessThan(100);
    expect(link.insertionIndex(link.middle)).toBe(0);
  });
});
