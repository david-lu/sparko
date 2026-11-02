import { connect, withReferenceFade, type StoryGraph } from './model';

/** Insert an existing interstitial without recreating its settings or generated media. */
export function insertIntoConnection(graph: StoryGraph, nodeId: string, edgeId: string): StoryGraph {
  const node = graph.nodes.find(n => n.id === nodeId), connection = graph.edges.find(e => e.id === edgeId);
  if (!node || node.kind === 'source' || !connection || connection.from === nodeId || connection.to === nodeId) return graph;
  const next = {
    ...graph,
    nodes: graph.nodes.map(n => n.id === nodeId ? { ...n, referenceId: connection.from } : n),
    edges: graph.edges.map(e => e.id === edgeId ? withReferenceFade({ ...e, to: nodeId, points: undefined }, graph.nodes) : e),
  };
  return next.edges.some(e => e.from === nodeId && e.to === connection.to)
    ? next : connect(next, nodeId, connection.to);
}
