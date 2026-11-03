import { describe, expect, it } from 'vitest';
import { createTestFlow, startSession } from '../../src/features/call-response/model';
import { connect, edge, runtimeFlow, type StoryGraph, type StoryNode } from '../../src/features/story-flow/model';
import { setBehavior } from '../../src/features/story-flow/behaviors';
import { previewFlowSegments, previewSegmentAt } from '../../src/features/player/previewSegments';

const node = (id: string): StoryNode => ({ id, name: id, kind: 'source', source: { assetId: 'video', inFrame: 0, outFrame: 48 }, x: 0, y: 0, loopCount: 0 });
const graph = (): StoryGraph => ({ version: 1, entryId: 'a', nodes: ['a', 'b', 'c', 'unused'].map(node), edges: [edge('a', 'b'), edge('b', 'c')], templates: [] });

describe('viewer timeline', () => {
  it('uses only connected playback footage and maps exact cut boundaries', () => {
    const flow = runtimeFlow(graph(), [], 'video', 6), segments = previewFlowSegments(flow, startSession(flow));
    expect(segments.map(s => [s.id, s.start, s.end])).toEqual([['a', 0, 2], ['b', 2, 4], ['c', 4, 6]]);
    expect(previewSegmentAt(segments, 1.99)?.id).toBe('a');
    expect(previewSegmentAt(segments, 2)?.id).toBe('b');
    expect(previewSegmentAt(segments, 6)?.id).toBe('c');
    expect(previewSegmentAt([], 0)).toBeUndefined();
  });
  it('projects one response and follows queued and previously traversed answers after rejoining', () => {
    const flow = createTestFlow(), session = startSession(flow);
    expect(previewFlowSegments(flow, session).map(s => s.id)).toEqual(['intro', 'call', 'wait', 'incorrect', 'continue']);
    const chosen = previewFlowSegments(flow, { ...session, sceneId: 'wait', outcome: 'correct' });
    expect(chosen.map(s => s.id)).toEqual(['intro', 'call', 'wait', 'correct', 'continue']);
    expect(previewFlowSegments(flow, { ...session, sceneId: 'continue', traversedEdgeIds: ['wait-correct', 'correct-continue'] }).map(s => s.id)).toEqual(chosen.map(s => s.id));
  });
  it('uses the branch selected in the editor, even before the viewer chooses an answer', () => {
    const flow = createTestFlow();
    const segments = previewFlowSegments(flow, { ...startSession(flow), sceneId: 'correct' });
    expect(segments.map(s => s.id)).toEqual(['intro', 'call', 'wait', 'correct', 'continue']);
  });
  it('keeps the opening of a detached sequence when advancing through its clips', () => {
    const value = graph(); value.entryId = 'unused';
    const flow = runtimeFlow(value, [], 'video', 6), session = startSession(flow);
    for (const sceneId of ['a', 'b', 'c']) {
      expect(previewFlowSegments(flow, { ...session, sceneId }).map(s => s.id)).toEqual(['a', 'b', 'c']);
    }
  });
  it('shows one loop pass and terminates cyclic connections', () => {
    let value = setBehavior(graph(), 'b', 'loop', true);
    value.edges.push(edge('c', 'a'));
    const flow = runtimeFlow(value, [], 'video', 6), segments = previewFlowSegments(flow, startSession(flow));
    expect(segments.map(s => s.id)).toEqual(['a', 'b', 'c']);
    expect(segments[1].kind).toBe('loop');
  });
  it('does not preview retained condition wires when that behavior is turned off', () => {
    let value = setBehavior({ ...graph(), edges: [] }, 'a', 'conditional', true);
    value = connect(value, 'a', 'b', undefined, value.nodes[0].conditions![0].id);
    value = setBehavior(value, 'a', 'conditional', false);
    const flow = runtimeFlow(value, [], 'video', 6);
    expect(previewFlowSegments(flow, startSession(flow)).map(s => s.id)).toEqual(['a']);
  });
  it('uses planned draft durations and marks them without requiring generated media', () => {
    const value = graph();
    value.nodes[1] = { ...value.nodes[1], source: undefined, kind: 'simple', interstitialId: 'draft' };
    const flow = runtimeFlow(value, [{ id: 'draft', label: 'A new scene', time: 2, phase: 'draft', duration: 5, start_range: 2, end_range: 2, prompt: '', enable_prompt_expansion: false }], 'video', 6);
    expect(previewFlowSegments(flow, startSession(flow))[1]).toMatchObject({ label: 'A new scene', start: 2, end: 7, kind: 'scene', draft: true });
  });
});
