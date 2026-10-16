import { describe, expect, it } from 'vitest';
import { referenceRange, type Interstitial } from '../../shared/interstitials';
import { INTERSTITIAL } from '../../shared/constants';
import { TimelineComposition } from '../../src/media/TimelineComposition';

const source = { id: 'source', name: 'Original', url: '/original.mp4' };
const info = { duration: 12, fps: 25, width: 320, height: 180, codec: 'avc', hasAudio: true };
const item = (id: string, time: number, duration = 5): Interstitial => ({ id, label: id, time, start_range: 2, end_range: 2, duration: 6, enable_prompt_expansion: false, prompt: 'A scene', phase: 'ready', result: { url: 'https://fal.media/result.mp4', start: 2, duration, totalDuration: duration + 4 } });

describe('frame-based timeline composition', () => {
  it('renders the source and inserted scenes on one 24 fps clock', () => {
    const composition = new TimelineComposition(source, info, [item('second', 8, 3), item('first', 4)]);
    expect(composition.duration).toBe(20);
    expect(composition.segments.map(segment => [segment.kind, segment.startFrame, segment.endFrame, segment.sourceStart])).toEqual([
      ['source', 0, 96, 0], ['interstitial', 96, 216, 2], ['source', 216, 312, 4], ['interstitial', 312, 384, 2], ['source', 384, 480, 8],
    ]);
    expect(composition.segments.filter(segment => segment.kind === 'source').reduce((total, segment) => total + segment.endFrame - segment.startFrame, 0)).toBe(288);
    expect(composition.timelineTime(8)).toBe(13);
    expect(composition.sourceTime(10)).toBe(5);
    expect(composition.sourceTime(6)).toBe(4);
    expect(composition.sourceTime(20)).toBe(12);
  });
  it('selects the exact frame on either side of each splice', () => {
    const composition = new TimelineComposition(source, info, [item('insert', 4)]);
    expect(composition.at(3.96).kind).toBe('source');
    expect(composition.at(4).id).toBe('insert');
    expect(composition.at(8.96).id).toBe('insert');
    expect(composition.at(9).sourceStart).toBe(4);
  });
  it('keeps the existing splice throughout retries and only uses a ready replacement', () => {
    const original = item('insert', 4);
    const replacement = { url: 'https://fal.media/new.mp4', start: 1, duration: 6, totalDuration: 9 };
    for (const phase of ['preparing', 'uploading', 'queued', 'rendering', 'loading', 'error', 'cancelled', 'draft'] as const) {
      const composition = new TimelineComposition(source, info, [{ ...original, phase, result: replacement, previousResult: original.result }]);
      expect(composition.segments).toEqual(new TimelineComposition(source, info, [original]).segments);
      expect(composition.duration).toBe(17);
    }
    const ready = new TimelineComposition(source, info, [{ ...original, result: replacement }]);
    expect(ready.duration).toBe(18);
    expect(ready.at(4)).toMatchObject({ source: { url: replacement.url }, sourceStart: 1 });
  });
  it('handles boundary anchors, multiple inserts at an anchor, and incomplete jobs', () => {
    const composition = new TimelineComposition(source, info, [item('end', 12), item('start-b', 0), item('start-a', 0), { ...item('pending', 5), phase: 'rendering' }]);
    expect(composition.duration).toBe(27);
    expect(composition.segments.map(segment => segment.id)).toEqual(['start-a', 'start-b', 'source:0', 'end']);
    expect(composition.timelineTime(6)).toBe(16);
    expect(composition.itemTime(item('end', 12))).toBe(22);
  });
  it('quantizes fractional frame rates without cumulative offsets', () => {
    const fps = 30000 / 1001;
    const composition = new TimelineComposition(source, { ...info, fps, duration: 300 / fps }, [item('one', 100 / fps, 150 / fps), item('two', 200 / fps, 150 / fps)]);
    expect(composition.segments.at(-1)?.endFrame).toBe(480);
    expect(composition.at(250 / fps).sourceStart).toBeCloseTo(80 / 24, 9);
  });
  it.each([12, 24, 24000 / 1001, 25, 30, 30000 / 1001, 50, 60, 120, 240])('uses 24 fps even without interstitials for %s fps sources', fps => {
    const composition = new TimelineComposition(source, { ...info, fps, duration: 12.01 }, []);
    expect(composition.fps).toBe(24);
    expect(composition.duration).toBe(12);
    expect(composition.segments.at(-1)?.endFrame).toBe(288);
    expect(composition.timelineTime(3.04)).toBe(73 / 24);
  });
  it('retains an end anchor rounded beyond the original file duration', () => {
    const composition = new TimelineComposition(source, { ...info, fps: 60, duration: 1.03 }, [item('end', 25 / 24)]);
    expect(composition.itemTime(item('end', 25 / 24))).toBe(25 / 24);
    expect(composition.segments.at(-1)?.id).toBe('end');
    expect(new TimelineComposition(source, { ...info, duration: 0.01 }, []).duration).toBe(1 / 24);
  });
});
describe('reference clips', () => {
  it('spans one frame on the 24 fps reference clock', () => {
    expect(referenceRange(item('draft', 6), 12)).toEqual({ start: 4, end: 8, insertAt: 2, resumeAt: 49 / 24, fps: 24 });
  });
  it.each([6, 6.01, 6.04, 6.5])('keeps distinct 24 fps positions for an anchor at %s', time => {
    for (const start_range of [1.625, 2, 2.01, 3.999]) {
      const range = referenceRange({ ...item('draft', time), start_range }, 12);
      expect(Math.floor(range.resumeAt * INTERSTITIAL.referenceFps)).toBeGreaterThan(Math.floor(range.insertAt * INTERSTITIAL.referenceFps));
      expect(range.resumeAt - range.insertAt).toBeGreaterThanOrEqual(1 / INTERSTITIAL.referenceFps - 1e-9);
      expect(range.resumeAt * 24).toBeCloseTo(Math.round(range.resumeAt * 24), 8);
      expect(range.start + range.insertAt).toBeCloseTo(Math.round(time * 24) / 24, 8);
    }
  });
  it('requires return footage after the replacement on both frame clocks', () => {
    expect(() => referenceRange(item('near-end', 11.96), 12)).toThrow('return transition');
    expect(() => referenceRange(item('near-end', 11.95), 12)).toThrow('return transition');
  });
  it('rejects impossible context and ranges over four seconds before uploading', () => {
    for (const draft of [{ ...item('a', 4), start_range: 5 }, { ...item('b', 4), end_range: 4.01 }, item('c', 0), item('d', 12)]) {
      expect(() => referenceRange(draft, 12)).toThrow();
    }
    expect(referenceRange(item('valid', 11), 12).end).toBe(12);
  });
});
