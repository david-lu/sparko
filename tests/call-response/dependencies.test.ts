import { describe, expect, it } from 'vitest';
import { baselineReferences, clipDependency } from '../../src/features/call-response/dependencies';
import { createTimelineExample, reconnectEdge } from '../../src/features/call-response/model';
import { referenceTiming } from '../../src/features/call-response/generation';

function example() {
  const { flow, interstitials } = createTimelineExample(crypto.randomUUID(), 12);
  return { flow, items: baselineReferences(flow, interstitials) };
}
describe('call-response generation dependencies', () => {
  it('uses Call for Idle and the same Idle for both branches, independent of retry edges', () => {
    const { flow, items } = example(), retry = reconnectEdge(flow, 'incorrect-continue', 'wait');
    expect(clipDependency(retry, items, 'wait').reference?.before.sceneId).toBe('call');
    for (const id of ['correct', 'incorrect'] as const) {
      expect(clipDependency(retry, items, id)).toMatchObject({ stale: false, reference: { before: { sceneId: 'wait' }, after: { sceneId: 'continue' } } });
    }
  });
  it('marks descendants stale after replacement, retains their media, and requires updates in order', () => {
    const { flow, items } = example();
    const call = items.find(item => item.id === 'call-response-call')!;
    const unchanged = items.slice(1).map(item => item.result);
    call.result = { ...call.result!, assetId: crypto.randomUUID() };
    expect(clipDependency(flow, items, 'wait')).toMatchObject({ stale: true, blocked: undefined });
    expect(clipDependency(flow, items, 'correct')).toMatchObject({ stale: true, blocked: expect.stringContaining('Regenerate Idle first') });
    const idle = items.find(item => item.id === 'call-response-wait')!;
    idle.result = { ...idle.result!, assetId: crypto.randomUUID(), reference: clipDependency(flow, items, 'wait').reference };
    expect(clipDependency(flow, items, 'wait').stale).toBe(false);
    expect(clipDependency(flow, items, 'incorrect')).toMatchObject({ stale: true, blocked: undefined });
    expect(items.slice(2).map(item => item.result)).toEqual(unchanged.slice(1));
  });
  it('does not invalidate the sibling branch and keeps generation enabled after a failed upstream replacement', () => {
    const { flow, items } = example();
    items[2].result = { ...items[2].result!, assetId: crypto.randomUUID() };
    expect(clipDependency(flow, items, 'incorrect').stale).toBe(false);
    items[0].previousResult = items[0].result; items[0].result = undefined; items[0].phase = 'rendering';
    expect(clipDependency(flow, items, 'wait').blocked).toContain('finish generating');
    items[0].phase = 'error';
    expect(clipDependency(flow, items, 'wait')).toMatchObject({ stale: false, blocked: undefined });
  });
  it('limits reference windows to real clip bounds and reserves a held return pose for Idle', () => {
    const { flow, items } = example();
    const input = clipDependency(flow, items, 'wait').reference!;
    expect(input.after).toBeUndefined();
    expect(referenceTiming(items[1], input)).toEqual({ before: 48, after: 48, time: 2, duration: 4 });
    const short = { ...input, before: { ...input.before, outFrame: input.before.inFrame + 12 } };
    expect(referenceTiming(items[1], short).time).toBe(.5);
  });
});
