import { INTERSTITIAL_CROSSFADE_FRAMES } from '../../../shared/constants';
import { referenceCrossfade } from '../../media/ReferenceCrossfade';
import { getScene, sceneFrames, type CallResponseFlow, type FlowEdge } from './model';

function referenceTransition(flow: CallResponseFlow, edge: FlowEdge, frames: number) {
  const before = getScene(flow, edge.from), after = getScene(flow, edge.to);
  if (!before || !after || before.id === after.id || edge.when === 'pending' || before.draft || after.draft) return;
  const input = after.generated?.reference?.before, output = before.generated?.reference;
  // Rewired or partially generated sequences must not blend unrelated reference footage.
  if (input && (input.assetId !== before.clip.assetId || input.outFrame !== before.clip.outFrame)) return;
  if (output && (!output.after || output.mode === 'loop' || output.mode === 'extend'
    || output.after.assetId !== after.clip.assetId || output.after.inFrame !== after.clip.inFrame)) return;
  const window = referenceCrossfade(
    { frames: sceneFrames(before), generated: !!before.interstitialId || before.clip.kind !== 'video', range: before.generated },
    { frames: sceneFrames(after), generated: !!after.interstitialId || after.clip.kind !== 'video', range: after.generated }, frames, flow.fps);
  return window && { before, after, ...window };
}

/** Reference footage only: entry ends at the body start; exit starts at the body end. */
export function flowTransition(flow: CallResponseFlow, edge: FlowEdge, crossfadeFrames = INTERSTITIAL_CROSSFADE_FRAMES) {
  const transition = referenceTransition(flow, edge, crossfadeFrames);
  if (!transition) return;
  const entering = transition.startFrame < 0, source = entering ? transition.before : transition.after;
  const neighbors = flow.edges.filter(other => entering ? other.to === source.id : other.from === source.id);
  const competing = Math.max(0, ...neighbors.map(other => referenceTransition(flow, other, crossfadeFrames)?.frames ?? 0));
  if (transition.frames + competing > sceneFrames(source)) {
    transition.frames = Math.min(transition.frames, entering ? Math.ceil(sceneFrames(source) / 2) : Math.floor(sceneFrames(source) / 2));
    transition.startFrame = entering ? -transition.frames : 0;
  }
  return transition.frames ? transition : undefined;
}
