import { TIMELINE_FPS } from '../../../shared/constants';
import { CLIP_HEIGHT, PIXELS_PER_SECOND, type CommentAnchor, type StoryComment, type StoryGraph, type StoryNode } from './model';

export const COMMENT_LIMIT = 1000;
export const COMMENT_TEXT_LIMIT = 4000;

export const isClipAnchor = (anchor: CommentAnchor): anchor is Extract<CommentAnchor, { nodeId: string }> => 'nodeId' in anchor;

/**
 * Clip comments use the same media frames as trimming: source frames for
 * imported footage, generated-body frames for renders. Trims and splits move
 * the clip's edges, never the moment a comment points at.
 */
export function mediaStart(node: StoryNode) {
  return node.source ? node.source.inFrame : node.generationId ? 0 : node.trim?.inFrame ?? 0;
}

/** Frames after the clip's playable start. Negative or past the end when a trim hides that moment. */
export const commentSceneFrame = (node: StoryNode, frame: number) => frame - mediaStart(node);

export const clipAnchor = (node: StoryNode, sceneFrame: number): CommentAnchor =>
  ({ nodeId: node.id, frame: Math.max(0, mediaStart(node) + Math.max(0, Math.round(sceneFrame))) });

/** The canvas point under a clip comment's pin: its moment on the clip's bottom edge. */
function pinPoint(node: StoryNode, frame: number) {
  return { x: node.x + Math.max(0, commentSceneFrame(node, frame)) / TIMELINE_FPS * PIXELS_PER_SECOND, y: node.y + CLIP_HEIGHT };
}

/**
 * Comments never disappear with their clip. When an edit removes a clip, its
 * comments stay where their pins were, as canvas comments. Undo restores both.
 */
export function keepComments(previous: Pick<StoryGraph, 'nodes'> | undefined, next: StoryGraph): StoryGraph {
  if (!next.comments?.length) return next;
  const ids = new Set(next.nodes.map(node => node.id));
  if (next.comments.every(comment => !isClipAnchor(comment.anchor) || ids.has(comment.anchor.nodeId))) return next;
  return { ...next, comments: next.comments.map(comment => {
    const anchor = comment.anchor;
    if (!isClipAnchor(anchor) || ids.has(anchor.nodeId)) return comment;
    const node = previous?.nodes.find(node => node.id === anchor.nodeId);
    return { ...comment, anchor: node ? pinPoint(node, anchor.frame) : { x: 40, y: 90 } };
  }) };
}

/** After a split, comments on the second half follow it to the new clip. */
export function splitComments(graph: StoryGraph, leftId: string, rightId: string): StoryGraph {
  const right = graph.nodes.find(node => node.id === rightId);
  if (!right || !graph.comments?.length) return graph;
  const start = mediaStart(right);
  return { ...graph, comments: graph.comments.map(comment => isClipAnchor(comment.anchor) && comment.anchor.nodeId === leftId && comment.anchor.frame >= start
    ? { ...comment, anchor: { ...comment.anchor, nodeId: rightId } } : comment) };
}

export function commentSummary(comment: Pick<StoryComment, 'text'>, length = 80) {
  const text = comment.text.replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
