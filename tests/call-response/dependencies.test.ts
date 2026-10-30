import { describe, expect, it } from 'vitest';
import { baselineReferences, clipDependency } from '../../src/features/call-response/dependencies';
import { changeClipKind, createTimelineExample, reconnectEdge } from '../../src/features/call-response/model';
import { referenceTiming } from '../../src/features/call-response/generation';

function example() {
  const { flow, interstitials } = createTimelineExample(crypto.randomUUID(), 12);
  return { flow, items: baselineReferences(flow, interstitials) };
}
describe('call-response generation dependencies', () => {
  it('uses Call for Idle and the same Idle for both branches, independent of retry edges', () => {
    const { flow, items } = example(), retry = reconnectEdge(flow, 'incorrect-continue', 'wait');
    expect(clipDependency(retry, items, 'wait').reference?.before!.sceneId).toBe('call');
    for (const id of ['correct', 'incorrect'] as const) {
      expect(clipDependency(retry, items, id)).toMatchObject({ stale: false, reference: { before: { sceneId: 'wait' }, after: { sceneId: 'continue' } } });
    }
  });
  it('uses the saved full Idle body as Response input without re-encoding the extracted loop', () => {
    const { flow, items } = example();
    const idle = items.find(item => item.id === 'call-response-wait')!;
    idle.result = { ...idle.result!, assetId: 'trimmed-idle', fullAssetId: 'full-idle',
      start: 0, duration: 2, totalDuration: 2,
      fullRange: { start: 2, duration: 2, totalDuration: 6 } };
    const before = clipDependency(flow, items, 'correct').reference!.before;
    expect(before).toEqual({ sceneId: 'wait', assetId: 'full-idle', inFrame: 48, outFrame: 96 });
    expect(referenceTiming(items[2], clipDependency(flow, items, 'correct').reference!)).toMatchObject({ before: 48 });
    // Existing renders made from the trimmed loop remain valid until Idle changes.
    items[2].result = { ...items[2].result!, reference: { ...items[2].result!.reference!,
      before: { sceneId: 'wait', assetId: 'trimmed-idle', inFrame: 0, outFrame: 48 } } };
    expect(clipDependency(flow, items, 'correct').stale).toBe(false);
    items[2].result = { ...items[2].result!, reference: undefined };
    expect(baselineReferences(flow, items)[2].result?.reference?.before!.assetId).toBe('trimmed-idle');
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
  it('invalidates all descendants when source footage is trimmed, and only responses when the return footage changes', () => {
    const { flow, items } = example();
    const intro = flow.scenes.find(scene => scene.id === 'intro')!;
    intro.clip.outFrame--;
    for (const id of ['call', 'wait', 'correct', 'incorrect']) expect(clipDependency(flow, items, id).stale).toBe(true);
    intro.clip.outFrame++;
    flow.scenes.find(scene => scene.id === 'continue')!.clip.inFrame++;
    expect(clipDependency(flow, items, 'call').stale).toBe(false);
    expect(clipDependency(flow, items, 'wait').stale).toBe(false);
    for (const id of ['correct', 'incorrect']) expect(clipDependency(flow, items, id).stale).toBe(true);
  });
  it('propagates through generated clips even after their type changes to Video', () => {
    const { flow, items } = example();
    const converted = changeClipKind(flow, 'wait', 'video');
    expect(clipDependency(converted, items, 'wait').stale).toBe(false);
    items[0].result = { ...items[0].result!, assetId: crypto.randomUUID() };
    expect(clipDependency(converted, items, 'wait').stale).toBe(true);
    expect(clipDependency(converted, items, 'correct')).toMatchObject({ stale: true, blocked: expect.stringContaining('Regenerate') });
  });
  it('does not call an unrendered draft stale but preserves stale status on retained footage', () => {
    const { flow, items } = example();
    items[0].result = { ...items[0].result!, assetId: crypto.randomUUID() };
    items[2] = { ...items[2], phase: 'draft', result: undefined };
    expect(clipDependency(flow, items, 'correct')).toMatchObject({ stale: false, blocked: expect.stringContaining('Regenerate Idle first') });
    items[1] = { ...items[1], previousResult: items[1].result, result: undefined };
    for (const phase of ['rendering', 'error', 'cancelled'] as const) {
      items[1].phase = phase;
      expect(clipDependency(flow, items, 'wait').stale).toBe(true);
      expect(clipDependency(flow, items, 'incorrect').stale).toBe(true);
    }
  });
  it('tracks rendered references independently of editable prompts and generation profiles', () => {
    const { flow, items } = example();
    items[0] = { ...items[0], prompt: 'A different call', duration: 9, method: 'comfy-extend' };
    items[1] = { ...items[1], start_range: 3, end_range: 3, method: 'comfy-loop' };
    for (const id of ['call', 'wait', 'correct', 'incorrect']) expect(clipDependency(flow, items, id).stale).toBe(false);
  });
  it('limits reference windows to real clip bounds and reserves a held return pose for Idle', () => {
    const { flow, items } = example();
    const input = clipDependency(flow, items, 'wait').reference!;
    expect(input.after).toBeUndefined();
    expect(referenceTiming(items[1], input)).toEqual({ before: 48, after: 48, time: 2, duration: 4 });
    const short = { ...input, before: { ...input.before!, outFrame: input.before!.inFrame + 12 } };
    expect(referenceTiming(items[1], short).time).toBe(.5);
  });
});
