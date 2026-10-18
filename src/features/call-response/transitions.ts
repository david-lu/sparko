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

function idleTransition(flow: CallResponseFlow, edge: FlowEdge, requestedFrames: number) {
  const before = getScene(flow, edge.from), after = getScene(flow, edge.to);
  if (!before || !after || before.draft || after.draft || !before.generated || !after.generated) return;
  const enteringIdle = after.clip.kind === 'idle' && (before.clip.kind === 'call' || before.clip.kind === 'response');
  const leavingIdle = before.clip.kind === 'idle' && (after.clip.kind === 'call' || after.clip.kind === 'response');
  if (!enteringIdle && !leavingIdle) return;
  // The Response was generated from the end of Idle's body. Its own saved
  // prefix length, not Idle's unrelated loop suffix, bounds this overlap.
  const submittedIdle = leavingIdle && after.generated.reference?.before;
  if (submittedIdle && (submittedIdle.assetId !== before.clip.assetId || submittedIdle.outFrame !== before.clip.outFrame)) return;
  const idlePrefix = after.clip.kind === 'idle' && after.generated.fullAssetId && after.generated.fullRange;
  const contextFrames = enteringIdle ? idlePrefix ? Math.floor(idlePrefix.start * flow.fps + 1e-6) : Infinity
    : Math.floor(after.generated.start * flow.fps + 1e-6);
  const frames = Math.max(0, Math.min(Math.floor(requestedFrames), sceneFrames(before), sceneFrames(after), contextFrames));
  // Both fades finish at their cut; Idle repeats do not fade.
  return frames ? { before, after, startFrame: -frames, frames } : undefined;
}

function candidateTransition(flow: CallResponseFlow, edge: FlowEdge, frames: number) {
  return idleTransition(flow, edge, frames) ?? referenceTransition(flow, edge, frames);
}

/** Fade through Idle's reference sections at entry and exit; repeats stay untouched. */
export function flowTransition(flow: CallResponseFlow, edge: FlowEdge, crossfadeFrames = INTERSTITIAL_CROSSFADE_FRAMES) {
  const transition = candidateTransition(flow, edge, crossfadeFrames);
  if (!transition) return;
  const entering = transition.startFrame < 0, source = entering ? transition.before : transition.after;
  const competing = Math.max(0, ...flow.edges.filter(other => other.id !== edge.id).map(other => {
    const candidate = candidateTransition(flow, other, crossfadeFrames);
    if (!candidate || (candidate.startFrame < 0) === entering) return 0;
    return (candidate.startFrame < 0 ? candidate.before : candidate.after).id === source.id ? candidate.frames : 0;
  }));
  if (transition.frames + competing > sceneFrames(source)) {
    transition.frames = Math.min(transition.frames, entering ? Math.ceil(sceneFrames(source) / 2) : Math.floor(sceneFrames(source) / 2));
    transition.startFrame = entering ? -transition.frames : 0;
  }
  return transition.frames ? transition : undefined;
}
