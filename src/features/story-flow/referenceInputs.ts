import type { Interstitial } from '../../../shared/interstitials';
import type { StoryGraph, StoryNode } from './model';
import { behaviors } from './behaviors';

/** Wires identify footage; loop generation reuses the incoming reference at both ends. */
export function connectedReferences(graph: StoryGraph, nodeId: string) {
  return {
    input: [...new Set(graph.edges.filter(e => e.to === nodeId && e.from !== nodeId).map(e => e.from))],
    output: [...new Set(graph.edges.filter(e => e.from === nodeId && e.to !== nodeId).map(e => e.to))],
  };
}

/** Loop behavior links the two boundaries; other clips retain independent switches. */
export function storyGenerationItem(item: Interstitial, node?: StoryNode): Interstitial {
  const useInputReference = item.useInputReference ?? true;
  if (node ? behaviors(node).loop : item.method === 'comfy-loop') return {
    ...item, method: 'comfy-loop', useInputReference, useOutputReference: useInputReference, end_range: item.start_range,
  };
  const useOutputReference = item.useOutputReference ?? item.method === 'comfy';
  return { ...item, useInputReference, useOutputReference, method: useOutputReference ? 'comfy' : 'comfy-extend' };
}
