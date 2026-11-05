import { TIMELINE_FPS } from '../../../shared/constants';
import { playableResult, type Interstitial } from '../../../shared/interstitials';
import type { TimelineScene } from '../call-response/model';
import { generatedBounds, PIXELS_PER_SECOND, type StoryNode } from './model';

export type TrimSide = 'start' | 'end';

/** Source ranges use file frames; generated ranges use the generated body's frames. */
export function clipTrimRange(node: StoryNode, items: Interstitial[], sourceDuration?: number) {
  if (node.source) {
    const duration = node.source.duration ?? sourceDuration;
    const totalFrames = node.source.kind === 'image' ? Infinity : Number.isFinite(duration) ? Math.max(1, Math.floor(duration! * TIMELINE_FPS)) : node.source.outFrame;
    return { inFrame: node.source.inFrame, outFrame: node.source.outFrame, totalFrames };
  }
  const item = items.find(item => item.id === node.interstitialId);
  const duration = item && playableResult(item)?.duration || item?.duration || 6;
  return { ...generatedBounds(node, duration), totalFrames: Math.max(1, Math.round(duration * TIMELINE_FPS)) };
}

export function trimClip(node: StoryNode, items: Interstitial[], side: TrimSide, frame: number, sourceDuration?: number): StoryNode {
  if (!Number.isFinite(frame)) return node;
  const range = clipTrimRange(node, items, sourceDuration);
  const inFrame = side === 'start' ? Math.max(0, Math.min(range.outFrame - 1, Math.round(frame))) : range.inFrame;
  const outFrame = side === 'end' ? Math.max(inFrame + 1, Math.min(range.totalFrames, Math.round(frame))) : range.outFrame;
  if (inFrame === range.inFrame && outFrame === range.outFrame) return node;
  // A start trim leaves the opposite end in place on the canvas.
  return { ...node, x: node.x + (inFrame - range.inFrame) / TIMELINE_FPS * PIXELS_PER_SECOND,
    ...(node.source ? { source: { ...node.source, inFrame, outFrame } }
      : { trim: inFrame === 0 && outFrame === range.totalFrames ? undefined : { inFrame, outFrame } }) };
}

/** Preview a trim without touching saved media or adding intermediate undo entries. */
export function trimPreviewScene(scene: TimelineScene, node: StoryNode, items: Interstitial[]): TimelineScene {
  const range = clipTrimRange(node, items), start = Math.round((scene.generated?.start ?? 0) * TIMELINE_FPS);
  return { ...scene, storyNode: node, plannedFrames: range.outFrame - range.inFrame,
    clip: scene.draft ? scene.clip : { ...scene.clip,
      inFrame: node.source ? range.inFrame : start + range.inFrame,
      outFrame: node.source ? range.outFrame : start + range.outFrame } };
}
