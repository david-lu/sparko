import { describe, expect, it } from 'vitest';
import type { Interstitial } from '../../shared/interstitials';
import { flowTransition } from '../../src/features/call-response/transitions';
import { connect, connectionFade, createNode, edge, migrateFades, runtimeFlow, splitClip, type StoryGraph, type StoryNode } from '../../src/features/story-flow/model';
import { storyGraphSchema } from '../../src/features/story-flow/schema';
import { instantiateTemplate, makePreset } from '../../src/features/story-flow/templates';

function fixture() {
  const assetId = crypto.randomUUID();
  const before: StoryNode = { id: 'before', name: 'Before', kind: 'source', x: 0, y: 0, loopCount: 0, source: { assetId, inFrame: 0, outFrame: 48 } };
  const after: StoryNode = { ...before, id: 'after', source: { assetId, inFrame: 48, outFrame: 96 } };
  const { node, item } = createNode('simple');
  item.useOutputReference = true;
  item.end_range = 1;
  let graph: StoryGraph = { version: 1, entryId: before.id, nodes: [before, node, after], edges: [], templates: [] };
  graph = connect(connect(graph, before.id, node.id), node.id, after.id);
  return { graph, node: graph.nodes[1], item, assetId };
}
const fades = (graph: StoryGraph, items: Interstitial[]) => graph.edges.map(e => connectionFade(e, graph.nodes, items));
function render(item: Interstitial, graph: StoryGraph, assetId: string) {
  item.phase = 'ready';
  item.result = { assetId: crypto.randomUUID(), url: 'blob:generated', start: 1.625, duration: 2, totalDuration: 4.125,
    reference: { mode: 'custom', before: { sceneId: graph.nodes[0].id, assetId, inFrame: 0, outFrame: 48 }, after: { sceneId: graph.nodes[2].id, assetId, inFrame: 48, outFrame: 96 } } };
}

describe('reference-based video fades', () => {
  it('keeps video and audio edits independent of each other and of automatic reference lengths', () => {
    const { graph, item, assetId } = fixture(), connection = graph.edges[0];
    connection.videoCrossfade = 0;
    expect(connectionFade(connection, graph.nodes, [item], 'video')).toBe(0);
    expect(connectionFade(connection, graph.nodes, [item], 'audio')).toBe(1.5);
    item.start_range = 1;
    expect(connectionFade(connection, graph.nodes, [item], 'audio')).toBe(.75);
    connection.audioCrossfade = .5;
    render(item, graph, assetId);
    const flow = runtimeFlow(graph, [item], assetId, 4);
    expect(flow.edges[0]).toMatchObject({ transitionFrames: 0, audioTransitionFrames: 12 });
    expect(flowTransition(flow, flow.edges[0])).toBeUndefined();
    expect(flowTransition(flow, flow.edges[0], undefined, 'audio')).toMatchObject({ startFrame: -12, frames: 12 });
  });

  it('retains legacy shared defaults and independent overrides through migration and template saving', () => {
    const { graph, item } = fixture();
    graph.edges[0] = { ...graph.edges[0], crossfade: .5, crossfadeReferenceRatio: undefined, videoCrossfade: 0 };
    graph.edges[1].audioCrossfade = 0;
    const template = makePreset('question');
    template.edges[0] = { ...template.edges[0], videoCrossfade: .25, audioCrossfade: .75 };
    graph.templates.push(template);
    const restored = migrateFades(storyGraphSchema.parse(JSON.parse(JSON.stringify(graph))));
    expect(restored.edges[0]).toMatchObject({ crossfade: .5, videoCrossfade: 0 });
    expect(restored.edges.map(e => connectionFade(e, restored.nodes, [item], 'video'))).toEqual([0, .75]);
    expect(restored.edges.map(e => connectionFade(e, restored.nodes, [item], 'audio'))).toEqual([.5, 0]);
    const instance = instantiateTemplate(restored, restored.templates[0], [item]);
    expect(instance.graph.edges.find(e => e.videoCrossfade === .25)).toMatchObject({ audioCrossfade: .75 });
    // A graph with only a video override must not acquire that value as its audio default on migration.
    restored.edges[0].crossfade = undefined;
    expect(connectionFade(migrateFades(restored).edges[0], restored.nodes, [item], 'audio')).toBe(.25);
  });

  it('preserves independent outgoing fades for loop exits and cuts on internal splits', () => {
    const { graph, node, item, assetId } = fixture();
    render(item, graph, assetId);
    node.loop = true;
    graph.edges[1].videoCrossfade = .25; graph.edges[1].audioCrossfade = .5;
    const flow = runtimeFlow(graph, [item], assetId, 4);
    expect(flow.edges.find(e => e.when === `${node.id}:continue`)).toMatchObject({ transitionFrames: 6, audioTransitionFrames: 12 });
    const repeat = flow.edges.find(e => e.when === 'repeat')!;
    expect(flowTransition(flow, repeat, undefined, 'audio')).toBeUndefined();
    const split = splitClip(graph, [item], node.id, 24);
    expect(split.graph.edges.find(e => e.to === 'after')).toMatchObject({ videoCrossfade: .25, audioCrossfade: .5 });
    expect(connectionFade(split.graph.edges.at(-1)!, split.graph.nodes, [item, ...split.items], 'audio')).toBe(0);
  });

  it('defaults new attachments to 75% of each enabled reference, bounded by the neighboring clip', () => {
    const { graph, item } = fixture();
    expect(fades(graph, [item])).toEqual([1.5, .75]);
    item.start_range = 4; item.end_range = 2;
    expect(fades(graph, [item])).toEqual([1.5, 1.5]);
    item.useInputReference = false;
    expect(fades(graph, [item])).toEqual([0, 1.5]);
    item.useOutputReference = false;
    expect(fades(graph, [item])).toEqual([0, 0]);
  });

  it('uses actual saved reference handles for playback and rounds to whole frames', () => {
    const { graph, item, assetId } = fixture();
    render(item, graph, assetId);
    // Settings for the next render must not change the video that is playing.
    item.start_range = 4; item.end_range = 4; item.useInputReference = false; item.useOutputReference = false;
    expect(fades(graph, [item])).toEqual([29 / 24, 9 / 24]);
    const flow = runtimeFlow(graph, [item], assetId, 4);
    expect(flow.edges.map(e => e.transitionFrames)).toEqual([29, 9]);
    expect(flowTransition(flow, flow.edges[0])).toMatchObject({ startFrame: -29, frames: 29 });
    expect(flowTransition(flow, flow.edges[1])).toMatchObject({ startFrame: 0, frames: 9 });
    item.previousResult = item.result; item.result = undefined; item.phase = 'rendering';
    expect(fades(graph, [item])).toEqual([29 / 24, 9 / 24]);
    item.phase = 'error';
    expect(fades(graph, [item])).toEqual([29 / 24, 9 / 24]);
  });

  it('uses retained full-video handles and keeps loop repeats seamless', () => {
    const { graph, node, item, assetId } = fixture();
    render(item, graph, assetId);
    item.result = { ...item.result!, fullAssetId: crypto.randomUUID(), fullRange: { start: 1.625, duration: 2, totalDuration: 4.125 }, start: 0, totalDuration: 2 };
    node.loop = true;
    const flow = runtimeFlow(graph, [item], assetId, 4);
    expect(fades(graph, [item])).toEqual([29 / 24, 9 / 24]);
    expect(flow.edges.find(e => e.when === `${node.id}:continue`)?.transitionFrames).toBe(9);
    expect(flow.edges.find(e => e.when === 'repeat')?.transitionFrames).toBe(0);
    expect(flowTransition(flow, flow.edges[0])?.frames).toBe(29);
  });

  it('preserves the outer fades when cutting generated footage and uses a cut inside its body', () => {
    const { graph, node, item, assetId } = fixture();
    render(item, graph, assetId);
    const split = splitClip(graph, [item], node.id, 24), items = [item, ...split.items];
    expect(fades(split.graph, items)).toEqual([29 / 24, 9 / 24, 0]);
    const flow = runtimeFlow(split.graph, items, assetId, 4);
    expect(flowTransition(flow, flow.edges[2])).toBeUndefined();
    node.trim = { inFrame: 12, outFrame: 36 };
    expect(fades(graph, [item])).toEqual([0, 0]);
  });

  it('prefers the next generated clip’s start reference and otherwise uses the previous end reference', () => {
    const { graph, item, node, assetId } = fixture(), next = createNode('simple');
    graph.nodes.push(next.node);
    const connected = connect(graph, node.id, next.node.id), connection = connected.edges.find(e => e.from === node.id)!;
    next.item.start_range = 2;
    expect(connectionFade(connection, connected.nodes, [item, next.item])).toBe(1.5);
    next.item.useInputReference = false;
    expect(connectionFade(connection, connected.nodes, [item, next.item])).toBe(.75);
    render(item, graph, assetId);
    item.result!.reference!.mode = 'extend';
    expect(connectionFade(connection, connected.nodes, [item, next.item])).toBe(0);
  });

  it('retains explicit fade edits and cuts when settings change or an existing connection is redirected', () => {
    const { graph, item, node } = fixture();
    graph.edges[0].crossfade = .5; graph.edges[1].crossfade = 0;
    item.start_range = 1.625; item.end_range = 4;
    expect(fades(graph, [item])).toEqual([.5, 0]);
    const next = createNode('simple'); graph.nodes.push(next.node);
    const rewired = connect(graph, graph.entryId, next.node.id, graph.edges[0].id);
    expect(fades(rewired, [item, next.item])).toEqual([.5, 0]);
    const sourceCut = { ...edge(graph.entryId, 'after'), crossfade: 0 };
    const attached = connect({ ...graph, edges: [sourceCut] }, graph.entryId, node.id, sourceCut.id);
    expect(fades(attached, [item])).toEqual([29 / 24]);
  });

  it('leaves source-to-source connections and existing project defaults unchanged', () => {
    const { graph, item } = fixture();
    const ordinary = connect({ ...graph, edges: [] }, graph.entryId, 'after');
    expect(fades(ordinary, [item])).toEqual([0]);
    const old = { ...graph, edges: [edge(graph.entryId, graph.nodes[1].id), { ...edge(graph.nodes[1].id, 'after'), crossfade: .5 }] };
    expect(fades(migrateFades(old), [item])).toEqual([.25, .5]);
    const self = connect({ ...graph, edges: [] }, graph.nodes[1].id, graph.nodes[1].id);
    expect(self.edges[0].crossfadeReferenceRatio).toBeUndefined();
    const flow = runtimeFlow(self, [item], '', 4);
    expect(flowTransition(flow, flow.edges[0])).toBeUndefined();
  });

  it('preserves automatic fades through saving and migration without freezing draft durations', () => {
    const { graph, item } = fixture(); graph.templates.push(makePreset('question'));
    const restored = migrateFades(storyGraphSchema.parse(JSON.parse(JSON.stringify(graph))));
    expect(fades(restored, [item])).toEqual([1.5, .75]);
    item.start_range = 1.625; item.end_range = 2;
    expect(fades(restored, [item])).toEqual([29 / 24, 1.5]);
    expect(restored.templates[0].edges.every(e => e.crossfadeReferenceRatio === .75 && e.crossfade === undefined)).toBe(true);
  });

  it('defaults template attachment boundaries while retaining saved internal fade edits', () => {
    const { graph } = fixture(), template = makePreset('question');
    template.edges[0].crossfade = .5;
    const cut = { ...edge(graph.entryId, 'after'), crossfade: 0 };
    const result = instantiateTemplate({ ...graph, edges: [cut] }, template, [], cut.id);
    const incoming = result.graph.edges.find(e => e.from === graph.entryId)!;
    expect(connectionFade(incoming, result.graph.nodes, result.items)).toBe(1.5);
    expect(result.graph.edges[0].crossfade).toBe(.5);
    expect(result.graph.edges.filter(e => e.to === 'after').every(e => e.crossfadeReferenceRatio === .75)).toBe(true);
  });
});
