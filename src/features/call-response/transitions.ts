import { INTERSTITIAL_CROSSFADE_FRAMES } from '../../../shared/constants';
import { referenceCrossfade } from '../../media/ReferenceCrossfade';
import { getScene, sceneFrames, type CallResponseFlow, type FlowEdge } from './model';
import { sceneMediaRange } from '../story-flow/mediaRange';
import { connectionReference } from '../story-flow/references';

function storyTransition(flow: CallResponseFlow, edge: FlowEdge) {
  const before = getScene(flow, edge.from), after = getScene(flow, edge.to), fps = flow.fps;
  const requested = Math.max(0, Math.round(edge.transitionFrames));
  if (!requested || !before || !after || before.id === after.id || before.draft || after.draft) return;
  if (connectionReference(flow,edge).state==='mismatch') return;
  const left = sceneMediaRange(before, fps), right = sceneMediaRange(after, fps);
  if (after.generated) {
    const result = after.generated, reference = result.reference?.before;
    // The prefix meets the original body start, never an arbitrary trim point.
    if (after.clip.inFrame !== Math.round(result.start * fps)) return;
    if (reference && !((reference.assetId === before.clip.assetId && reference.outFrame === before.clip.outFrame)
      || (reference.assetId === left.assetId && reference.outFrame === Math.round(left.end * fps)))) return;
    const frames = Math.min(requested, sceneFrames(before), Math.floor(right.start * fps + 1e-6));
    return frames > 0 ? { before, after, startFrame: -frames, frames } : undefined;
  }
  if (before.generated) {
    const result = before.generated, reference = result.reference;
    if (before.clip.outFrame !== Math.round((result.start + result.duration) * fps)) return;
    if (reference && (!reference.after || reference.mode === 'loop' || reference.mode === 'extend'
      || reference.after.assetId !== after.clip.assetId || reference.after.inFrame !== after.clip.inFrame)) return;
    const frames = Math.min(requested, sceneFrames(after), Math.floor(((left.total ?? left.end) - left.end) * fps + 1e-6));
    return frames > 0 ? { before, after, startFrame: 0, frames } : undefined;
  }
  // Ordinary footage has no generated reference interval: dissolve around the cut.
  const frames = Math.min(requested, sceneFrames(before), sceneFrames(after));
  return frames > 0 ? { before, after, startFrame: -Math.floor(frames / 2), frames } : undefined;
}

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
  const full = before.generated.fullAssetId && before.generated.fullRange;
  const fullOutFrame = full ? Math.round(full.start * flow.fps) + sceneFrames(before) : undefined;
  if (submittedIdle && !(submittedIdle.assetId === before.clip.assetId && submittedIdle.outFrame === before.clip.outFrame)
    && !(full && submittedIdle.assetId === before.generated.fullAssetId && submittedIdle.outFrame === fullOutFrame)) return;
  const idlePrefix = after.clip.kind === 'idle' && after.generated.fullAssetId && after.generated.fullRange;
  const contextFrames = enteringIdle ? idlePrefix ? Math.floor(idlePrefix.start * flow.fps + 1e-6) : Infinity
    : Math.floor(after.generated.start * flow.fps + 1e-6);
  const frames = Math.max(0, Math.min(Math.floor(requestedFrames), sceneFrames(before), sceneFrames(after), contextFrames));
  // Both fades finish at their cut; Idle repeats do not fade.
  return frames ? { before, after, startFrame: -frames, frames } : undefined;
}

function candidateTransition(flow: CallResponseFlow, edge: FlowEdge, frames: number) {
  if (flow.storyGraph) return storyTransition(flow, edge);
  return idleTransition(flow, edge, frames) ?? referenceTransition(flow, edge, frames);
}

/** Fade through Idle's reference sections at entry and exit; repeats stay untouched. */
export function flowTransition(flow: CallResponseFlow, edge: FlowEdge, crossfadeFrames = INTERSTITIAL_CROSSFADE_FRAMES) {
  const transition = candidateTransition(flow, edge, crossfadeFrames);
  if (!transition) return;
  if(flow.storyGraph){
    let pre=Math.max(0,-transition.startFrame),post=Math.max(0,transition.startFrame+transition.frames);
    const others=flow.edges.filter(e=>e.id!==edge.id).map(e=>storyTransition(flow,e)).filter(t=>!!t);
    const earlier=Math.max(0,...others.filter(t=>t.after.id===transition.before.id).map(t=>Math.max(0,t.startFrame+t.frames)));
    const later=Math.max(0,...others.filter(t=>t.before.id===transition.after.id).map(t=>Math.max(0,-t.startFrame)));
    if(pre+earlier>sceneFrames(transition.before))pre=Math.min(pre,Math.ceil(sceneFrames(transition.before)/2));
    if(post+later>sceneFrames(transition.after))post=Math.min(post,Math.floor(sceneFrames(transition.after)/2));
    return pre+post?{...transition,startFrame:pre?-pre:0,frames:pre+post}:undefined;
  }
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
