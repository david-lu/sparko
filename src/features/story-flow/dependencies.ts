import { isGenerating, playableResult, type ClipReference, type GenerationReference, type Interstitial } from '../../../shared/interstitials';
import { sameReference, type ClipDependency } from '../call-response/dependencies';
import { runtimeFlow, type StoryGraph } from './model';
import { sceneMediaRange } from './mediaRange';
import { connectedReferences, storyGenerationItem } from './referenceInputs';

/** Resolve current wires; each saved render retains its own immutable provenance. */
export function storyDependency(graph: StoryGraph, items: Interstitial[], assetId: string, duration: number, itemId: string): ClipDependency {
  const node = graph.nodes.find(n => n.interstitialId === itemId), saved = items.find(i => i.id === itemId);
  if (!node || !saved) return { label: 'Source', stale: false };
  const item = storyGenerationItem(saved), connected = connectedReferences(graph, node.id);
  const flow = runtimeFlow(graph, items, assetId, duration), byId = new Map(flow.scenes.map(s => [s.id, s]));
  const ref = (id: string): ClipReference => {
    const scene = byId.get(id)!, range = sceneMediaRange(scene, flow.fps);
    return { sceneId: id, assetId: range.assetId, inFrame: Math.round(range.start * flow.fps), outFrame: Math.round(range.end * flow.fps) };
  };
  const matches = (input: ClipReference, current: ClipReference) => {
    const scene = byId.get(current.sceneId)!;
    return input.assetId === current.assetId && input.inFrame === current.inFrame && input.outFrame === current.outFrame
      || input.assetId === scene.clip.assetId && input.inFrame === scene.clip.inFrame && input.outFrame === scene.clip.outFrame;
  };
  const input: GenerationReference = { mode: 'custom' };
  let blocked: string | undefined;
  for (const side of ['input', 'output'] as const) {
    if (!(side === 'input' ? item.useInputReference : item.useOutputReference)) continue;
    const ids = connected[side];
    if (ids.length !== 1) {
      blocked ??= ids.length ? `${side === 'input' ? 'Input' : 'Output'} reference needs one connected clip. Turn it off for multiple ${side === 'input' ? 'inputs' : 'destinations'}.`
        : `Connect ${side === 'input' ? 'an incoming' : 'a following'} clip, or turn off its ${side} reference.`;
      continue;
    }
    input[side === 'input' ? 'before' : 'after'] = ref(ids[0]);
    const scene = byId.get(ids[0])!, job = items.find(i => i.id === scene.interstitialId);
    if (scene.draft || job && isGenerating(job)) blocked ??= `Generate ${scene.label} first, or turn off its ${side} reference.`;
    // Check saved footage, without recursively following future settings through playback cycles.
    for (const previous of [job && playableResult(job)?.reference?.before, job && playableResult(job)?.reference?.after]) {
      if (previous && byId.has(previous.sceneId) && !matches(previous, ref(previous.sceneId))) blocked ??= `Regenerate ${scene.label} to match its updated reference first.`;
    }
  }
  const submitted = playableResult(saved)?.reference, normalized = submitted ? { ...submitted } : undefined;
  if (normalized) {
    if (normalized.mode !== 'loop') normalized.mode = 'custom';
    for (const side of ['before', 'after'] as const) {
      if (normalized[side] && input[side] && matches(normalized[side]!, input[side]!)) normalized[side] = input[side];
    }
  }
  return { label: byId.get(input.before?.sceneId ?? input.after?.sceneId ?? '')?.label ?? 'No reference footage', reference: input, blocked, stale: !!normalized && !sameReference(normalized, input) };
}
