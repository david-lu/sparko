import type { Interstitial, ReferenceType } from '../../../shared/interstitials';
import type { StoryGraph, StoryNode } from './model';
import { behaviors } from './behaviors';

/** Wires identify footage; loop generation reuses the incoming reference at both ends. */
export function connectedReferences(graph: StoryGraph, nodeId: string) {
  return {
    input: [...new Set(graph.edges.filter(e => e.to === nodeId && e.from !== nodeId).map(e => e.from))],
    output: [...new Set(graph.edges.filter(e => e.from === nodeId && e.to !== nodeId).map(e => e.to))],
  };
}

export function referenceType(item: Interstitial, side: 'start' | 'end'): ReferenceType {
  const explicit = side === 'start' ? item.startReferenceType : item.endReferenceType;
  if (explicit) return explicit;
  const video = side === 'start' ? item.useInputReference ?? true : item.useOutputReference ?? item.method === 'comfy';
  if (video) return 'video';
  const index = side === 'start' ? item.startImageIndex : item.endImageIndex;
  return index !== undefined || item.method === 'comfy-loop' && !!item.imageReferences?.length ? 'image' : 'none';
}

/** Loop behavior links the two boundaries; other clips retain independent references. */
export function storyGenerationItem(item: Interstitial, node?: StoryNode): Interstitial {
  const loop = node ? behaviors(node).loop : item.method === 'comfy-loop';
  const start = referenceType(loop ? { ...item, method: 'comfy-loop' } : item, 'start');
  const end = loop ? start : referenceType(item, 'end');
  const useInputReference = start === 'video', useOutputReference = end === 'video';
  const startImageIndex = start === 'image' ? item.startImageIndex ?? 0 : undefined;
  const endImageIndex = end === 'image' ? loop ? startImageIndex : item.endImageIndex ?? 0 : undefined;
  return { ...item, useInputReference, useOutputReference, startImageIndex, endImageIndex,
    method: loop ? 'comfy-loop' : useOutputReference ? 'comfy' : 'comfy-extend', ...(loop ? { end_range: item.start_range } : {}) };
}
