import { interactionFor, sceneFrames, type CallResponseFlow, type PlaybackSession, type TimelineScene } from '../call-response/model';
import { behaviors } from '../story-flow/behaviors';
import type { TimelineComposition } from '../../media/TimelineComposition';

export type PreviewSegment = {
  id: string; sceneId?: string; label: string; start: number; end: number;
  kind: 'source' | 'scene' | 'loop' | 'choice'; draft?: boolean;
};
export const previewLabels = { source: 'Video', scene: 'Scene', loop: 'Loop', choice: 'Choice' };

function sceneKind(scene: TimelineScene): PreviewSegment['kind'] {
  if (scene.storyNode) {
    const behavior = behaviors(scene.storyNode);
    if (behavior.conditional) return 'choice';
    if (behavior.loop) return 'loop';
  }
  if (scene.clip.kind === 'idle') return 'choice';
  return scene.interstitialId || scene.clip.kind !== 'video' ? 'scene' : 'source';
}

/** A single pass through the current route. Repeats and alternative answers are
 * not laid end-to-end as if they were additional footage. */
export function previewFlowSegments(flow: CallResponseFlow, session: PlaybackSession | null): PreviewSegment[] {
  const scenes = new Map(flow.scenes.map(scene => [scene.id, scene]));
  const outgoing = (id: string) => {
    const scene = scenes.get(id);
    if (!scene) return [];
    const interaction = interactionFor(flow, id);
    const conditional = scene.storyNode ? behaviors(scene.storyNode).conditional : scene.clip.kind === 'idle';
    const edges = flow.edges.filter(edge => edge.from === id && edge.to !== id && scenes.has(edge.to)
      && (edge.when === 'ended' ? !conditional : scene.clip.kind === 'idle' && interaction.answers.some(answer => answer.id === edge.when)));
    const preferred = edges.find(edge => edge.when === session?.outcome)
      ?? [...(session?.traversedEdgeIds ?? [])].reverse().map(edgeId => edges.find(edge => edge.id === edgeId)).find(Boolean)
      ?? edges.find(edge => edge.when === interaction.fallbackAnswerId)
      ?? edges.find(edge => edge.when === 'ended')
      ?? edges.find(edge => edge.when === interaction.answers[0]?.id);
    return preferred ? [preferred, ...edges.filter(edge => edge !== preferred)] : edges;
  };
  const walk = (prefix: string[]) => {
    const path = [...prefix], visited = new Set(path);
    let id = outgoing(path.at(-1) ?? '')[0]?.to;
    while (id && !visited.has(id)) {
      path.push(id); visited.add(id);
      id = outgoing(id)[0]?.to;
    }
    return path;
  };
  let path = scenes.has(flow.entrySceneId) ? walk([flow.entrySceneId]) : [];
  // Scrubbing an alternate branch in the editor should preview that same branch.
  if (session && scenes.has(session.sceneId) && !path.includes(session.sceneId)) {
    const edges = flow.scenes.flatMap(scene => outgoing(scene.id));
    const ancestors = new Set([session.sceneId]), pending = [session.sceneId];
    for (let index = 0; index < pending.length; index++) for (const edge of edges) {
      if (edge.to === pending[index] && !ancestors.has(edge.from)) { ancestors.add(edge.from); pending.push(edge.from); }
    }
    // A detached template has its own opening clip. Keep that origin stable as
    // playback advances, instead of shortening the bar to each new active clip.
    const root = ancestors.has(flow.entrySceneId) ? flow.entrySceneId
      : flow.scenes.find(scene => ancestors.has(scene.id) && !edges.some(edge => edge.to === scene.id))?.id
        ?? flow.scenes.find(scene => ancestors.has(scene.id))!.id;
    const parents = new Map<string, string | null>([[root, null]]), queue = [root];
    for (let index = 0; index < queue.length && !parents.has(session.sceneId); index++) {
      for (const edge of outgoing(queue[index])) if (!parents.has(edge.to)) { parents.set(edge.to, queue[index]); queue.push(edge.to); }
    }
    const prefix: string[] = [];
    let id: string | null = session.sceneId;
    while (id) { prefix.unshift(id); id = parents.get(id) ?? null; }
    path = walk(prefix);
  }
  let cursor = 0;
  return path.map(id => {
    const scene = scenes.get(id)!, start = cursor;
    cursor += sceneFrames(scene) / flow.fps;
    return { id, sceneId: id, label: scene.label, start, end: cursor, kind: sceneKind(scene), draft: scene.draft };
  });
}

export function previewCompositionSegments(composition: TimelineComposition | null): PreviewSegment[] {
  return composition?.segments.map(segment => ({ id: segment.id, label: segment.label,
    start: segment.startFrame / composition.fps, end: segment.endFrame / composition.fps,
    kind: segment.kind === 'source' ? 'source' : 'scene', draft: segment.still })) ?? [];
}

export function previewSegmentAt(segments: PreviewSegment[], time: number) {
  return segments.find(segment => time < segment.end) ?? segments.at(-1);
}
