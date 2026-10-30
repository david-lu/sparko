import type { Interstitial } from '../../../shared/interstitials';
import type { StoryGraph } from './model';

/** Wires are the only source of generation references. Repeats are playback, not inputs. */
export function connectedReferences(graph: StoryGraph, nodeId: string) {
  return {
    input: [...new Set(graph.edges.filter(e => e.to === nodeId && e.from !== nodeId).map(e => e.from))],
    output: [...new Set(graph.edges.filter(e => e.from === nodeId && e.to !== nodeId).map(e => e.to))],
  };
}

/** Legacy methods supply defaults; the two switches determine future story renders. */
export function storyGenerationItem(item: Interstitial): Interstitial {
  const useInputReference = item.useInputReference ?? true;
  const useOutputReference = item.useOutputReference ?? item.method === 'comfy';
  return { ...item, useInputReference, useOutputReference, method: useOutputReference ? 'comfy' : 'comfy-extend' };
}
