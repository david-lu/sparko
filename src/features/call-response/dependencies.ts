import { isGenerating, playableResult, type ClipReference, type GenerationReference, type Interstitial } from '../../../shared/interstitials';
import { branchScenes, clipTypeLabel, getScene, resolveFlow, type CallResponseFlow, type SceneId, type TimelineScene } from './model';

// Generation follows the scene's original sequence, independent of playback retry loops.
export const predecessor = (flow: CallResponseFlow, id: SceneId): SceneId | undefined => id === 'intro' ? undefined
  : id === 'call' ? 'intro' : id === 'wait' ? 'call' : id === 'continue' ? branchScenes(flow)[0]?.id : 'wait';
const reference = (scene: TimelineScene): ClipReference => ({ sceneId: scene.id, assetId: scene.clip.assetId, inFrame: scene.clip.inFrame, outFrame: scene.clip.outFrame });
const sameClip = (a?: ClipReference, b?: ClipReference) => a?.sceneId === b?.sceneId && a?.assetId === b?.assetId && a?.inFrame === b?.inFrame && a?.outFrame === b?.outFrame;
export const sameReference = (a: GenerationReference, b: GenerationReference) => a.mode === b.mode && sameClip(a.before, b.before) && sameClip(a.after, b.after);
export type ClipDependency = { reference?: GenerationReference; label: string; blocked?: string; stale: boolean };

/** Follow the media actually used by the render, including both sides of a bridge. */
function staleResult(flow: CallResponseFlow, items: Interstitial[], scene: TimelineScene, visited = new Set<string>()): boolean {
  if (visited.has(scene.id)) return false;
  visited.add(scene.id);
  const item = items.find(item => item.id === scene.interstitialId);
  const submitted = item && playableResult(item)?.reference;
  // A draft has no rendered video to invalidate. Unsubmitted settings do not change existing footage.
  if (!submitted) return false;
  return [submitted.before, submitted.after].some(input => {
    if (!input) return false;
    const upstream = flow.scenes.find(scene => scene.id === input.sceneId);
    return !upstream || !sameClip(input, reference(upstream)) || staleResult(flow, items, upstream, visited);
  });
}

export function clipDependency(flow: CallResponseFlow, items: Interstitial[], id: SceneId): ClipDependency {
  const resolved = resolveFlow(flow, items), scene = getScene(resolved, id), previousId = predecessor(flow, id);
  if (!previousId) return { label: 'Source video', blocked: 'This clip needs a preceding source clip before it can be generated.', stale: false };
  const previous = getScene(resolved, previousId), upstream = items.find(item => item.id === previous.interstitialId);
  const label = clipTypeLabel(previous.clip, flow) || previous.label;
  const item = items.find(item => item.id === scene.interstitialId);
  const input: GenerationReference = { before: reference(previous), ...(item?.method === 'comfy-extend' ? { mode: 'extend' as const }
    : item?.method === 'comfy-loop' ? { mode: 'loop' as const, after: reference(previous) }
    : scene.clip.kind === 'response' && id !== 'continue' ? { after: reference(getScene(resolved, 'continue')) } : {}) };
  const upstreamState = upstream && predecessor(flow, previousId) ? clipDependency(flow, items, previousId) : undefined;
  const stale = staleResult(resolved, items, scene);
  const blocked = upstream && isGenerating(upstream) ? `Wait for ${label} to finish generating.`
    : upstream && !playableResult(upstream) ? `Generate ${label} first.`
    : upstreamState?.stale ? `Regenerate ${label} first to use the updated preceding clip.` : upstreamState?.blocked;
  return { reference: input, label, blocked, stale };
}

/** Remember which placeholder/legacy media the current child videos were built against. */
export function baselineReferences(flow: CallResponseFlow, items: Interstitial[]): Interstitial[] {
  return items.map(item => {
    if ((!item.result || item.result.reference) && (!item.previousResult || item.previousResult.reference)) return item;
    const scene = flow.scenes.find(scene => scene.interstitialId === item.id);
    const input = scene && clipDependency(flow, items, scene.id).reference;
    return input ? { ...item,
      result: item.result && !item.result.reference ? { ...item.result, reference: input } : item.result,
      previousResult: item.previousResult && !item.previousResult.reference ? { ...item.previousResult, reference: input } : item.previousResult,
    } : item;
  });
}
