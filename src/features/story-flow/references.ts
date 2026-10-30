import type { ClipReference } from '../../../shared/interstitials';
import { getScene, type CallResponseFlow, type FlowEdge, type TimelineScene } from '../call-response/model';
import { sceneMediaRange } from './mediaRange';

export function matchesReference(reference:ClipReference,scene:TimelineScene,fps:number,side:'start'|'end') {
  const range=sceneMediaRange(scene,fps),frame=side==='end'?'outFrame':'inFrame';
  return reference.assetId===scene.clip.assetId&&reference[frame]===scene.clip[frame]
    || reference.assetId===range.assetId&&reference[frame]===Math.round((side==='end'?range.end:range.start)*fps);
}
export function referenceName(reference:ClipReference,flow:CallResponseFlow) {
  return (flow.scenes.find(s=>s.id===reference.sceneId)??flow.scenes.find(s=>s.clip.assetId===reference.assetId||s.generated?.fullAssetId===reference.assetId))?.label??'the saved reference clip';
}
/** Provenance is from the playable render, never the next generation's editable settings. */
export function connectionReference(flow:CallResponseFlow,edge:FlowEdge):{state:'match'|'mismatch'|'unknown'|'draft'|'repeat';message:string} {
  const before=getScene(flow,edge.from),after=getScene(flow,edge.to),fps=flow.fps;
  if(before.id===after.id)return {state:'repeat',message:'Repeats the same saved video.'};
  if(before.draft||after.draft)return {state:'draft',message:'Reference matching is checked when both clips have playable video.'};
  const left=sceneMediaRange(before,fps),right=sceneMediaRange(after,fps);
  if(left.assetId===right.assetId&&Math.round(left.end*fps)===Math.round(right.start*fps))return {state:'match',message:'Adjacent portions of the same saved video. This cut is continuous.'};
  if(after.generated && (after.generated.reference?.before || after.generated.reference?.mode !== 'custom')){
    const result=after.generated,input=result.reference?.before;
    if(!input)return {state:'unknown',message:'This older render has no saved reference identity to compare.'};
    if(after.clip.inFrame!==Math.round(result.start*fps))return {state:'mismatch',message:'The destination starts inside its generated section, so its saved opening reference no longer meets this cut. Playback still works.'};
    if(!matchesReference(input,before,fps,'end'))return {state:'mismatch',message:`${after.label} was generated from ${referenceName(input,flow)}, using the ending at ${(input.outFrame/fps).toFixed(3)} s. The connected clip uses different footage or a different ending. Playback still works.`};
    return {state:'match',message:`The saved opening reference matches ${before.label} at ${(input.outFrame/fps).toFixed(3)} s.`};
  }
  if(before.generated){
    const result=before.generated,reference=result.reference;
    if(!reference?.after)return {state:'unknown',message:'No ending reference was saved for this connection. Playback uses a cut.'};
    if(before.clip.outFrame!==Math.round((result.start+result.duration)*fps)||reference.mode==='loop'||!matchesReference(reference.after,after,fps,'start'))
      return {state:'mismatch',message:`The saved ending reference comes from ${referenceName(reference.after,flow)}${reference.mode==='loop'?' to close the loop':` at ${(reference.after.inFrame/fps).toFixed(3)} s`}. It does not match this destination cut. Playback still works.`};
    return {state:'match',message:`The saved ending reference matches ${after.label} at ${(reference.after.inFrame/fps).toFixed(3)} s.`};
  }
  return {state:'unknown',message:after.generated?'Input reference was disabled for this render. Playback uses a cut.':'These are source clips; no generated reference is needed.'};
}
