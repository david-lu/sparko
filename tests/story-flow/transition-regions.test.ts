import { expect, it } from 'vitest';
import { createNode, edge, nodeMediaLayout, runtimeFlow, type StoryGraph, type StoryNode } from '../../src/features/story-flow/model';
import { flowTransition } from '../../src/features/call-response/transitions';
import { transitionRegions } from '../../src/features/story-flow/transitionRegions';

function fixture() {
  const before: StoryNode = { id: 'before', name: 'Before', kind: 'source', source: { assetId: 'source', duration: 10, inFrame: 0, outFrame: 48 }, x: 0, y: 0, loopCount: 0 };
  const after: StoryNode = { ...before, id: 'after', name: 'Parent video', source: { ...before.source!, inFrame: 48, outFrame: 240 } };
  const { node, item } = createNode('simple');
  item.phase = 'ready'; item.result = { assetId: 'render', url: 'asset:render', start: 1.625, duration: 6.166666666666667, totalDuration: 9.416666666666666, reference: { mode: 'custom' } };
  const graph: StoryGraph = { version: 1, entryId: before.id, nodes: [before, node, after], templates: [], edges: [
    { ...edge(before.id, node.id), videoCrossfade: .5, audioCrossfade: .75 },
    { ...edge(node.id, after.id), videoCrossfade: 14/24, audioCrossfade: 21/24 },
  ] };
  const flow = () => runtimeFlow(graph, [item], 'source', 10);
  const regions = () => transitionRegions(flow(), graph.edges, Object.fromEntries(graph.nodes.map(n => [n.id, nodeMediaLayout(n, [item])])));
  return { graph, node, item, flow, regions };
}

it('fades imported footage with no linked references, with separate video and audio regions on both clips', () => {
  const { node, graph, flow, regions } = fixture(), runtime = flow();
  expect(flowTransition(runtime, runtime.edges[1])).toMatchObject({ startFrame: 0, frames: 14 });
  expect(flowTransition(runtime, runtime.edges[1], undefined, 'audio')).toMatchObject({ startFrame: 0, frames: 21 });
  const spans = regions();
  expect(spans[node.id]).toHaveLength(4);
  expect(spans[node.id].find(r => r.edgeId === graph.edges[0].id && r.channel === 'video')).toMatchObject({ start: 1.125, end: 1.625, direction: 'in' });
  const video = spans[node.id].find(r => r.edgeId === graph.edges[1].id && r.channel === 'video')!;
  expect(video.mediaStart).toBeCloseTo(187/24); expect(video.mediaEnd).toBeCloseTo(201/24);
  const audio = spans[node.id].find(r => r.edgeId === graph.edges[1].id && r.channel === 'audio')!;
  expect(audio.mediaStart).toBeCloseTo(187/24); expect(audio.mediaEnd).toBeCloseTo(208/24);
  expect(spans.after.find(r => r.channel === 'video')).toMatchObject({ start: 0, end: 14/24, mediaStart: 2, direction: 'in' });
});

it('does not change fade timing when reference identities, frame ranges or modes differ', () => {
  const { item, flow, regions } = fixture(), original = regions();
  item.result!.reference = { mode: 'loop', before: { sceneId: 'unrelated', assetId: 'old-source', inFrame: 100, outFrame: 200 },
    after: { sceneId: 'other', assetId: 'old-parent', inFrame: 300, outFrame: 400 } };
  expect(regions()).toEqual(original);
  const runtime = flow();
  expect(flowTransition(runtime, runtime.edges[0])).toMatchObject({ startFrame: -12, frames: 12 });
});

it('uses a centered dissolve when no extra footage is available and only marks visible portions', () => {
  const { graph, item, node, flow, regions } = fixture();
  item.result = { ...item.result!, start: 0, duration: 2, totalDuration: 2 };
  const runtime = flow();
  expect(flowTransition(runtime, runtime.edges[0])).toMatchObject({ startFrame: -6, frames: 12 });
  const spans = regions();
  expect(spans.before.find(r => r.channel === 'video')).toMatchObject({ start: 1.75, end: 2 });
  expect(spans[node.id].find(r => r.edgeId === graph.edges[0].id && r.channel === 'video')).toMatchObject({ start: 0, end: .25 });
});

it('removes only the disabled channel and does not draw transitions on drafts or repeat edges', () => {
  const { graph, node, item, regions } = fixture();
  graph.edges[0].videoCrossfade = 0;
  graph.edges.push({ ...edge(node.id, node.id), crossfade: 1 });
  const incoming = regions()[node.id].filter(r => r.edgeId === graph.edges[0].id);
  expect(incoming.map(r => r.channel)).toEqual(['audio']);
  expect(regions()[node.id].some(r => r.edgeId === graph.edges[2].id)).toBe(false);
  item.result = undefined; item.phase = 'rendering';
  expect(regions()).toEqual({});
});
