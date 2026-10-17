import { isGenerating, playableResult, type ClipReference, type GenerationReference, type Interstitial } from '../../../shared/interstitials';
import { clipTypeLabel, getScene, resolveFlow, type CallResponseFlow, type SceneId, type TimelineScene } from './model';

// Generation follows the scene's original sequence, independent of playback retry loops.
export const predecessor = (id: SceneId): SceneId | undefined => ({ call: 'intro', wait: 'call', correct: 'wait', incorrect: 'wait', continue: 'correct' } as const)[id as Exclude<SceneId, 'intro'>];
const reference = (scene: TimelineScene): ClipReference => ({ sceneId: scene.id, assetId: scene.clip.assetId, inFrame: scene.clip.inFrame, outFrame: scene.clip.outFrame });
const sameClip = (a?: ClipReference, b?: ClipReference) => a?.sceneId === b?.sceneId && a?.assetId === b?.assetId && a?.inFrame === b?.inFrame && a?.outFrame === b?.outFrame;
export const sameReference = (a: GenerationReference, b: GenerationReference) => sameClip(a.before, b.before) && sameClip(a.after, b.after);
export type ClipDependency = { reference?: GenerationReference; label: string; blocked?: string; stale: boolean };

export function clipDependency(flow: CallResponseFlow, items: Interstitial[], id: SceneId): ClipDependency {
  const resolved = resolveFlow(flow, items), scene = getScene(resolved, id), previousId = predecessor(id);
  if (!previousId) return { label: 'Source video', blocked: 'This clip needs a preceding source clip before it can be generated.', stale: false };
  const previous = getScene(resolved, previousId), upstream = items.find(item => item.id === previous.interstitialId);
  const label = clipTypeLabel(previous.clip) || previous.label;
  const input: GenerationReference = { before: reference(previous), ...(scene.clip.kind === 'response' && id !== 'continue' ? { after: reference(getScene(resolved, 'continue')) } : {}) };
  const item = items.find(item => item.id === scene.interstitialId), submitted = item && playableResult(item)?.reference;
  const upstreamState = previous.clip.kind !== 'video' && predecessor(previousId) ? clipDependency(flow, items, previousId) : undefined;
  const stale = !!upstreamState?.stale || !!submitted && !sameReference(submitted, input);
  const blocked = upstream && isGenerating(upstream) ? `Wait for ${label} to finish generating.`
    : upstream && !playableResult(upstream) ? `Generate ${label} first.`
    : upstreamState?.stale ? `Regenerate ${label} first to use the updated preceding clip.` : upstreamState?.blocked;
  return { reference: input, label, blocked, stale };
}

/** Remember which placeholder/legacy media the current child videos were built against. */
export function baselineReferences(flow: CallResponseFlow, items: Interstitial[]): Interstitial[] {
  return items.map(item => {
    const scene = flow.scenes.find(scene => scene.interstitialId === item.id && scene.clip.kind !== 'video');
    const input = scene && clipDependency(flow, items, scene.id).reference;
    return input ? { ...item,
      result: item.result && !item.result.reference ? { ...item.result, reference: input } : item.result,
      previousResult: item.previousResult && !item.previousResult.reference ? { ...item.previousResult, reference: input } : item.previousResult,
    } : item;
  });
}
