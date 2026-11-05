import type { CallResponseFlow } from '../call-response/model';
import { flowTransition } from '../call-response/transitions';
import { sceneMediaRange } from './mediaRange';
import type { FadeChannel, nodeMediaLayout, StoryEdge } from './model';

export type TransitionRegion = {
  edgeId: string; channel: FadeChannel; direction: 'in' | 'out'; neighbor: string;
  start: number; end: number; mediaStart: number; mediaEnd: number; duration: number;
};

/** Intersect the actual playback overlap with each clip's visible media range. */
export function transitionRegions(flow: CallResponseFlow, edges: StoryEdge[], layouts: Record<string, ReturnType<typeof nodeMediaLayout>>) {
  const regions: Record<string, TransitionRegion[]> = {};
  for (const connection of edges) {
    const edge = flow.edges.find(edge => edge.id === connection.id);
    if (!edge) continue;
    for (const channel of ['video', 'audio'] as const) {
      const transition = flowTransition(flow, edge, undefined, channel);
      if (!transition) continue;
      for (const direction of ['in', 'out'] as const) {
        const scene = direction === 'in' ? transition.after : transition.before, layout = layouts[scene.id];
        if (!layout?.total) continue;
        const offset = layout.before + (direction === 'out' ? layout.body : 0) + transition.startFrame / flow.fps;
        const start = Math.max(0, offset), end = Math.min(layout.total, offset + transition.frames / flow.fps);
        if (end <= start) continue;
        const mediaStart = sceneMediaRange(scene, flow.fps).start - layout.before + start;
        (regions[scene.id] ??= []).push({ edgeId: edge.id, channel, direction,
          neighbor: (direction === 'in' ? transition.before : transition.after).label,
          start, end, mediaStart, mediaEnd: mediaStart + end - start, duration: transition.frames / flow.fps });
      }
    }
  }
  return regions;
}

/** Shared by connection strokes and their clip overlays, including interaction states. */
export function connectionColor(state: { mismatch: boolean; selected: boolean; hovered: boolean; traversed: boolean; dropTarget: boolean }) {
  if (state.dropTarget) return 'var(--accent)';
  if (state.mismatch) return '#f17c76';
  if (state.selected || state.hovered) return 'var(--accent)';
  return state.traversed ? '#b5cab9' : '#a89c8c';
}
