import { describe, expect, it } from 'vitest';
import { createNode, edge, nodeMediaLayout, runtimeFlow, type StoryGraph, type StoryNode } from '../../src/features/story-flow/model';
import { storyDependency } from '../../src/features/story-flow/dependencies';
import { referenceHighlights } from '../../src/features/story-flow/referenceHighlights';
import { clipMetadata } from '../fixtures/clip-metadata';

function setup() {
  const source = (id: string, inFrame: number, outFrame: number, image = false): StoryNode => ({ id, name: id, kind: 'source', x: 0, y: 0, loopCount: 0,
    source: { assetId: id, inFrame, outFrame, ...(image ? { kind: 'image' } : { duration: 10 }) } });
  const a = source('earlier', 24, 96), b = source('previous', 24, 72, true), c = source('following', 24, 48), d = source('later', 24, 120);
  const { item, node } = createNode('simple');
  Object.assign(item, { start_range: 4, end_range: 4, startReferenceType: 'video', endReferenceType: 'video' });
  const items = [item], graph: StoryGraph = { version: 1, entryId: a.id, nodes: [a, b, node, c, d], edges: [edge(a.id, b.id), edge(b.id, node.id), edge(node.id, c.id), edge(c.id, d.id)], templates: [] };
  const reference = () => storyDependency(graph, items, '', 0, item.id).reference;
  const highlight = (aliases?: Record<string, string>) => referenceHighlights(runtimeFlow(graph, items, '', 0), [{ item, node, reference: reference() }],
    Object.fromEntries(graph.nodes.map(node => [node.id, nodeMediaLayout(node, items)])), aliases);
  return { a, b, c, d, item, node, graph, items, reference, highlight };
}

describe('selected generation reference highlights', () => {
  it('highlights only the requested portions across multiple videos and still images', () => {
    const { highlight, item } = setup(), ranges = highlight();
    expect(Object.keys(ranges)).toEqual(['earlier', 'previous', 'following', 'later']);
    expect(ranges.earlier).toMatchObject([{ side: 'start', start: 1, end: 3, mediaStart: 2, mediaEnd: 4 }]);
    expect(ranges.previous).toMatchObject([{ side: 'start', start: 0, end: 2 }]);
    expect(ranges.following).toMatchObject([{ side: 'end', start: 0, end: 1 }]);
    expect(ranges.later).toMatchObject([{ side: 'end', start: 0, end: 3 }]);
    item.start_range = 1; item.endReferenceType = 'none';
    expect(highlight()).toMatchObject({ previous: [{ start: 1, end: 2 }] });
    expect(Object.keys(highlight())).toEqual(['previous']);
  });

  it('uses saved timings and provenance after settings or connections change, including regeneration', () => {
    const { item, graph, reference, highlight } = setup();
    item.result = { url: '', assetId: 'render', start: 1, duration: 2, totalDuration: 4, reference: reference() };
    item.phase = 'ready'; item.start_range = 3; item.end_range = 3; graph.edges = [];
    const saved = highlight();
    expect(Object.keys(saved)).toEqual(['previous', 'following']);
    expect(saved.previous).toMatchObject([{ start: 1, end: 2, mediaStart: 2, mediaEnd: 3 }]);
    expect(saved.following).toMatchObject([{ start: 0, end: 1 }]);
    item.previousResult = item.result; item.result = undefined; item.phase = 'rendering';
    item.requestReference = { mode: 'custom' };
    expect(highlight()).toEqual(saved);
  });

  it('keeps the submitted windows while the first generation is pending', () => {
    const { item, reference, highlight, graph } = setup();
    item.requestReference = reference(); item.generationSettings = { ...item };
    item.phase = 'rendering'; item.start_range = .5; item.end_range = .5; graph.edges = [];
    expect(highlight().earlier).toMatchObject([{ start: 1, end: 3 }]);
    expect(highlight().later).toMatchObject([{ start: 0, end: 3 }]);
  });

  it('marks only the held final frame as a loop ending and omits draft placeholder media', () => {
    const { node, item, b, highlight, items, graph } = setup();
    node.loop = true;
    expect(highlight().previous).toMatchObject([{ side: 'start', start: 0, end: 2 }, { side: 'end', held: true, mediaStart: 71 / 24, mediaEnd: 3 }]);
    expect(highlight().following).toBeUndefined();
    const draft = createNode('simple'); items.push(draft.item);
    graph.nodes.push({ ...draft.node, id: b.id }); graph.nodes = graph.nodes.filter(n => n !== b);
    expect(highlight()[b.id]).toBeUndefined();
    item.startReferenceType = 'none'; expect(highlight()).toEqual({});
  });

  it('matches arbitrary assets to visible ranges without highlighting unrelated copies of a connected clip', () => {
    const { a, b, item, graph, highlight } = setup();
    graph.nodes.push({ ...b, id: 'duplicate' });
    expect(highlight().duplicate).toBeUndefined();
    item.useStartVideoAsset = true; item.endReferenceType = 'none'; item.start_range = 2;
    item.startVideoAssets = [{ name: 'Custom video', ...a.source!, inFrame: 0, outFrame: 60 }];
    expect(highlight().earlier).toMatchObject([{ start: 0, end: 1.5, mediaStart: 1, mediaEnd: 2.5 }]);
    a.source!.inFrame = 72; expect(highlight()).toEqual({});
  });

  it('projects references into full generated media handles and translates playable loop coordinates', () => {
    const { a, graph, items, item, highlight } = setup(), upstream = createNode('looped');
    upstream.item.phase = 'ready'; upstream.item.result = { url: '', assetId: 'loop', fullAssetId: 'full', start: 0, duration: 3, totalDuration: 3,
      fullRange: { start: 2, duration: 3, totalDuration: 7 } };
    graph.nodes = graph.nodes.map(n => n === a ? { ...upstream.node, id: a.id } : n); items.push(upstream.item);
    item.phase = 'ready'; item.result = { url: '', start: 1, duration: 2, totalDuration: 3,
      reference: { mode: 'custom', before: { sceneId: a.id, assetId: 'loop', inFrame: 0, outFrame: 72 } } };
    expect(highlight().earlier).toMatchObject([{ start: 4, end: 5, mediaStart: 4, mediaEnd: 5 }]);
    item.result.reference!.before = { sceneId: a.id, assetId: 'full', inFrame: 0, outFrame: 48 };
    expect(highlight().earlier).toMatchObject([{ start: 1, end: 2, mediaStart: 1, mediaEnd: 2 }]);
  });

  it('recovers portable saved references through aliases without requiring current connections', () => {
    const { a, item, graph, highlight } = setup();
    item.phase = 'ready'; item.result = { url: '', ...clipMetadata.media, metadata: { ...clipMetadata, references: { mode: 'custom', before: { ...clipMetadata.references.before!, assetId: 'old-asset', sceneId: 'old-node' } } }, reference: { mode: 'custom' } };
    graph.edges = [];
    expect(highlight()).toEqual({});
    expect(highlight({ 'old-asset': a.source!.assetId }).earlier).toMatchObject([{ start: 2, end: 3, mediaStart: 3, mediaEnd: 4 }]);
  });

  it('does not invent provenance for an older completed render from the current wires', () => {
    const { item, highlight } = setup();
    item.phase = 'ready'; item.result = { url: '', start: 2, duration: 2, totalDuration: 6 };
    expect(highlight()).toEqual({});
  });
});
