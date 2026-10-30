import { describe, expect, it } from 'vitest';
import { copyGroups, groupClips, moveClips } from '../../src/features/story-flow/groups';
import { createNode, edge, removeNodes, splitClip, type StoryGraph, type StoryNode } from '../../src/features/story-flow/model';
import { captureTemplate, instantiateTemplate, makePreset } from '../../src/features/story-flow/templates';
import { storyGraphSchema } from '../../src/features/story-flow/schema';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { assetIds, emptyAnalysis, type Project } from '../../src/features/project/types';

const setup = () => {
  const source: StoryNode = { id: 'video', name: 'Video', kind: 'source', x: -500, y: 20, loopCount: 0, source: { assetId: crypto.randomUUID(), inFrame: 0, outFrame: 240 } };
  const a = createNode('simple'), b = createNode('simple'); a.node.x = -30; b.node.x = 350;
  const graph: StoryGraph = { version: 1, entryId: source.id, templates: [], nodes: [source, a.node, b.node], edges: [edge(source.id, a.node.id), { ...edge(a.node.id, b.node.id), points: [{ id: 'bend', x: 300, y: -80 }] }] };
  return { graph, source, a, b, items: [a.item, b.item] };
};

describe('clip groups and reusable templates', () => {
  it('creates a named group without changing clip timing, layout or connections', () => {
    const { graph, a, b } = setup(), result = groupClips(graph, [a.node.id, b.node.id], 'Dialogue', 'purple');
    expect(result.graph.nodes).toBe(graph.nodes); expect(result.graph.edges).toBe(graph.edges);
    expect(result.group).toMatchObject({ name: 'Dialogue', color: 'purple', nodeIds: [a.node.id, b.node.id] });
    expect(storyGraphSchema.safeParse(result.graph).success).toBe(true);
  });
  it('moves members and internal bends together while retaining external routing points', () => {
    const { graph, a, b, source } = setup(); graph.edges[0].points = [{ id: 'external', x: -100, y: 20 }];
    const grouped = groupClips(graph, [a.node.id, b.node.id], 'Move').graph, moved = moveClips(grouped, [a.node.id, b.node.id], -144, 88);
    expect(moved.nodes[0]).toEqual(source);
    expect(moved.nodes[1]).toMatchObject({ x: a.node.x - 144, y: a.node.y + 88 });
    expect(moved.nodes[2]).toMatchObject({ x: b.node.x - 144, y: b.node.y + 88 });
    expect(moved.edges[1].points).toEqual([{ id: 'bend', x: 156, y: 8 }]);
    expect(moved.edges[0]).toBe(graph.edges[0]); expect(moved.groups).toBe(grouped.groups);
  });
  it('regroups explicitly selected members without moving or taking unrelated clips', () => {
    const { graph, a, b, source } = setup();
    const first = groupClips(graph, [a.node.id, b.node.id], 'First').graph;
    const second = groupClips(first, [source.id, a.node.id], 'Second').graph;
    expect(second.groups?.map(g => g.nodeIds)).toEqual([[b.node.id], [source.id, a.node.id]]);
    expect(storyGraphSchema.safeParse(second).success).toBe(true);
  });
  it('keeps both halves of a split in the same group and removes empty groups on clip deletion', () => {
    const { graph, a, source, items } = setup(), grouped = groupClips(graph, [source.id, a.node.id], 'Cut').graph;
    const split = splitClip(grouped, items, a.node.id, 48);
    expect(split.graph.groups![0].nodeIds).toEqual([source.id, a.node.id, split.rightId]);
    const sourceSplit = splitClip(split.graph, [...items, ...split.items], source.id, 48);
    expect(sourceSplit.graph.groups![0].nodeIds).toContain(sourceSplit.rightId);
    const removed = removeNodes(sourceSplit.graph, sourceSplit.graph.groups![0].nodeIds);
    expect(removed.groups).toEqual([]); expect(storyGraphSchema.safeParse(removed).success).toBe(true);
  });
  it('duplicates complete groups with new identities and leaves partial selections ungrouped', () => {
    const { graph, a, b } = setup(), grouped = groupClips(graph, [a.node.id, b.node.id], 'Group', 'green').graph;
    expect(copyGroups(grouped, new Map([[a.node.id, 'one']]))).toEqual([]);
    const copy = copyGroups(grouped, new Map([[a.node.id, 'one'], [b.node.id, 'two']]))[0];
    expect(copy).toMatchObject({ name: 'Group copy', color: 'green', nodeIds: ['one', 'two'] }); expect(copy.id).not.toBe(grouped.groups![0].id);
  });
  it('instantiates every template as an independent persistent group at the drop point', () => {
    const { graph, items } = setup(), template = makePreset('question');
    const first = instantiateTemplate(graph, template, items, undefined, { x: -650, y: -220 });
    const second = instantiateTemplate(first.graph, template, [...items, ...first.items], undefined, { x: 1250, y: 520 });
    expect(second.graph.groups).toHaveLength(2); expect(first.groupId).not.toBe(second.groupId);
    expect(second.graph.nodes.find(n => n.id === second.selectedId)).toMatchObject({ x: 1250, y: 520 });
    expect(new Set(second.graph.groups!.flatMap(g => g.nodeIds)).size).toBe(8);
    expect(second.graph.nodes.slice(0, graph.nodes.length)).toEqual(graph.nodes);
  });
  it('archives groups and templates containing footage even after the original source node is removed', async () => {
    const { graph, source, a, items } = setup(), grouped = groupClips(graph, [source.id, a.node.id], 'Reusable scene', 'rose').graph;
    const template = captureTemplate(grouped, grouped.groups![0].nodeIds, items, 'Reusable scene')!;
    expect(template.nodes.some(n => n.source)).toBe(true); expect(template.color).toBe('rose');
    grouped.templates = [template]; const remaining = removeNodes(grouped, [source.id]);
    const primary = crypto.randomUUID(), project: Project = { id: 'groups', name: 'Groups', updatedAt: 1, source: { name: 'Primary', assetId: primary }, storyFlow: remaining, interstitials: items, subtitle: null, analysis: emptyAnalysis() };
    expect(assetIds(project)).toContain(source.source!.assetId);
    const signal = new AbortController().signal, files = assetIds(project).map(id => ({ id, name: 'clip.mp4', blob: new Blob(['fixture'], { type: 'video/mp4' }) }));
    const restored = await unpackProject(await packProject(project, files, signal, () => {}), signal, () => {});
    expect(restored.project.storyFlow!.groups).toEqual(remaining.groups);
    const saved = restored.project.storyFlow!.templates[0], asset = saved.nodes.find(n => n.source)!.source!.assetId;
    expect(asset).not.toBe(source.source!.assetId); expect(restored.assets.some(a => a.id === asset)).toBe(true);
    const inserted = instantiateTemplate(restored.project.storyFlow!, saved, restored.project.interstitials);
    expect(inserted.items).toHaveLength(1); expect(inserted.graph.nodes.filter(n => n.source)).toHaveLength(1);
    expect(inserted.graph.groups!.at(-1)?.color).toBe('rose'); expect(storyGraphSchema.safeParse(inserted.graph).success).toBe(true);
  });
  it('rejects duplicate membership, duplicate group identities, and missing members', () => {
    const { graph, a } = setup(), grouped = groupClips(graph, [a.node.id], 'Group').graph, group = grouped.groups![0];
    for (const groups of [[group, { ...group, id: 'other' }], [group, { ...group, nodeIds: ['video'] }], [{ ...group, nodeIds: ['missing'] }]]) {
      expect(storyGraphSchema.safeParse({ ...grouped, groups }).success).toBe(false);
    }
  });
});
