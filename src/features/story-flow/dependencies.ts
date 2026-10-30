import { isGenerating, playableResult, type ClipReference, type GenerationReference, type Interstitial } from '../../../shared/interstitials';
import { sameReference, type ClipDependency } from '../call-response/dependencies';
import { runtimeFlow, type StoryGraph } from './model';
import { sceneMediaRange } from './mediaRange';

/** Reference selection is explicit, so playback cycles cannot create generation recursion. */
export function storyDependency(graph:StoryGraph,items:Interstitial[],assetId:string,duration:number,itemId:string):ClipDependency {
  const node=graph.nodes.find(n=>n.interstitialId===itemId),item=items.find(i=>i.id===itemId);
  if(!node||!item)return {label:'Source',stale:false};
  const flow=runtimeFlow(graph,items,assetId,duration),byId=new Map(flow.scenes.map(s=>[s.id,s]));
  const before=byId.get(node.referenceId??'');
  if(!before)return {label:'Reference clip',blocked:'Connect an incoming clip or choose a generation reference first.',stale:false};
  const ref=(id:string):ClipReference=>{const s=byId.get(id)!,range=sceneMediaRange(s,flow.fps);return {sceneId:id,assetId:range.assetId,inFrame:Math.round(range.start*flow.fps),outFrame:Math.round(range.end*flow.fps)};};
  const matches=(input:ClipReference,current:ClipReference)=>{const scene=byId.get(current.sceneId)!;
    return input.assetId===current.assetId&&input.inFrame===current.inFrame&&input.outFrame===current.outFrame
      || input.assetId===scene.clip.assetId&&input.inFrame===scene.clip.inFrame&&input.outFrame===scene.clip.outFrame;};
  const outgoing=graph.edges.find(e=>e.from===node.id&&e.to!==node.id&&e.event==='next');
  const after=outgoing&&byId.get(outgoing.to);
  const input:GenerationReference=item.method==='comfy-loop'?{mode:'loop',before:ref(before.id),after:ref(before.id)}
    :item.method==='comfy-extend'?{mode:'extend',before:ref(before.id)}:{mode:'bridge',before:ref(before.id),after:after&&!after.draft?ref(after.id):undefined};
  const submitted=playableResult(item)?.reference;
  const seen=new Set<string>([node.id]);let upstream=graph.nodes.find(n=>n.id===before.id),blocked:string|undefined;
  while(upstream){
    if(seen.has(upstream.id)){blocked='Generation references form a cycle. Choose an earlier source clip.';break;}seen.add(upstream.id);
    const job=items.find(i=>i.id===upstream!.interstitialId);
    if(job&&(isGenerating(job)||!playableResult(job))){blocked=`Generate ${upstream.name} first, or choose a ready reference clip.`;break;}
    const rendered=job&&playableResult(job)?.reference;
    if(rendered){for(const previous of [rendered.before,rendered.after])if(previous&&byId.has(previous.sceneId)){
      const now=ref(previous.sceneId);if(!matches(previous,now))blocked=`Regenerate ${upstream.name} to match its updated reference first.`;
    }}
    upstream=graph.nodes.find(n=>n.id===upstream!.referenceId);
  }
  if(item.method==='comfy'&&!after)blocked??='Connect a following clip for a bridge, or choose Extend / Loop generation.';
  if(item.method==='comfy'&&after?.draft)blocked??=`Generate ${after.label} first, or use Extend generation.`;
  const normalized=submitted?{...submitted,mode:submitted.mode??'bridge',before:{...submitted.before,sceneId:input.before.sceneId},after:submitted.after&&input.after?{...submitted.after,sceneId:input.after.sceneId}:submitted.after}:undefined;
  if(normalized){if(matches(normalized.before,input.before))normalized.before=input.before;if(normalized.after&&input.after&&matches(normalized.after,input.after))normalized.after=input.after;}
  return {label:before.label,reference:input,blocked,stale:!!normalized&&!sameReference(normalized,input)};
}
