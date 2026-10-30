import { freshId, type StoryGraph, type StoryGroup } from './model';

/** Membership is explicit, so a nearby clip never accidentally moves with a group. */
export function groupClips(graph: StoryGraph, ids: string[], name: string, color: StoryGroup['color'] = 'blue') {
  const selected = new Set(ids), nodeIds = graph.nodes.filter(n => selected.has(n.id)).map(n => n.id);
  if (!nodeIds.length) return { graph, group: undefined };
  const group: StoryGroup = { id: freshId(), name: name.trim().slice(0, 200) || 'Group', nodeIds, color };
  const groups = (graph.groups ?? []).map(g => ({ ...g, nodeIds: g.nodeIds.filter(id => !selected.has(id)) })).filter(g => g.nodeIds.length);
  return { graph: { ...graph, groups: [...groups, group] }, group };
}

/** Translate internal bends with their clips; external wire anchors follow the sockets. */
export function moveClips(graph: StoryGraph, ids: string[], dx: number, dy: number): StoryGraph {
  const selected = new Set(ids);
  return { ...graph, nodes: graph.nodes.map(n => selected.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n),
    edges: graph.edges.map(e => selected.has(e.from) && selected.has(e.to) ? { ...e, points: e.points?.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })) } : e) };
}

export function copyGroups(graph: StoryGraph, remap: Map<string, string>) {
  return (graph.groups ?? []).filter(g => g.nodeIds.every(id => remap.has(id))).map(g => ({ ...g, id: freshId(), name: `${g.name} copy`.slice(0,200), nodeIds: g.nodeIds.map(id => remap.get(id)!) }));
}
