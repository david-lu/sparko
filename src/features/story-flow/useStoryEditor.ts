import { useEffect, useState } from 'react';
import { playableResult, type Interstitial } from '../../../shared/interstitials';
import type { ProjectController } from '../project/ProjectController';
import type { InterstitialController } from '../interstitials/InterstitialController';
import type { VideoPlayerController } from '../player/VideoPlayerController';
import { autoLayout, connect, createNode, edge, freshId, nodeDuration, splitClip, type NodeKind, type StoryGraph, type StoryNode, type StoryTemplate, type StoryGroup } from './model';
import { captureTemplate, instantiateTemplate, makePreset } from './templates';
import { groupClips, copyGroups } from './groups';
import { conditionsFor, normalizeConditions, setBehavior } from './behaviors';
import type { StoryCondition } from './model';
import { TIMELINE_FPS } from '../../../shared/constants';

export function useStoryEditor(graph:StoryGraph|undefined,items:Interstitial[],projects:ProjectController,jobs:InterstitialController,player:VideoPlayerController) {
  const [selected,setSelection]=useState<string[]>([]),[selectedGroupId,setSelectedGroupId]=useState<string|null>(null),[selectedEdge,setSelectedEdge]=useState<string|null>(null),[connecting,setConnecting]=useState<{from:string;edgeId?:string}|null>(null);
  const [notice,setNotice]=useState(''),[focusRevision,setFocusRevision]=useState(0),[inspectorRevision,setInspectorRevision]=useState(0);
  const source=projects.getSnapshot().source;
  const selectedGroup=graph?.groups?.find(g=>g.id===selectedGroupId);
  const setSelected=(value:string[]|((ids:string[])=>string[]))=>{setSelectedGroupId(null);setSelection(value);};
  useEffect(()=>{setSelected([]);setSelectedEdge(null);setConnecting(null);setNotice('');},[source]);
  const selectConnection=(id:string)=>{setSelectedEdge(id);setSelected([]);jobs.select(null);setInspectorRevision(n=>n+1);};
  useEffect(()=>{setSelection(ids=>ids.filter(id=>graph?.nodes.some(n=>n.id===id)));setSelectedGroupId(id=>graph?.groups?.some(g=>g.id===id)?id:null);setSelectedEdge(id=>graph?.edges.some(e=>e.id===id)?id:null);setConnecting(null);},[graph?.entryId,graph?.nodes.length,graph?.groups?.length,projects.getSnapshot().historyRevision]);
  const change=(next:StoryGraph,added:Interstitial[]=[])=>{player.pause();projects.updateStoryFlow(next,added);};
  const selectGroup=(id:string,next=graph)=>{const group=next?.groups?.find(g=>g.id===id);if(!group)return;setSelectedGroupId(id);setSelection(group.nodeIds);setSelectedEdge(null);jobs.select(null);setInspectorRevision(n=>n+1);};
  const patchGroup=(id:string,patch:Partial<Pick<StoryGroup,'name'|'color'>>)=>{if(graph)change({...graph,groups:graph.groups?.map(g=>g.id===id?{...g,...patch,name:patch.name?.trim().slice(0,200)||g.name}:g)});};
  const groupSelection=(name=`Group ${(graph?.groups?.length??0)+1}`)=>{if(!graph||!selected.length)return;const result=groupClips(graph,selected,name);if(!result.group)return;change(result.graph);selectGroup(result.group.id,result.graph);setNotice('Group created. Drag its header to move the clips together.');};
  const ungroup=(id=selectedGroup?.id)=>{if(!graph)return;const groups=graph.groups?.filter(g=>id?g.id!==id:!g.nodeIds.some(n=>selected.includes(n)));change({...graph,groups});setSelectedGroupId(null);setNotice('Ungrouped. Clips and connections are preserved.');};
  const select=(id:string,frame=0,multiple=false)=>{
    setSelected(ids=>multiple?ids.includes(id)?ids.filter(value=>value!==id):[...ids,id]:[id]);setSelectedEdge(null);
    jobs.select(graph?.nodes.find(n=>n.id===id)?.interstitialId??null);
    if(!multiple)player.seekFlowScene(id,frame);
  };
  const selectNew=(id:string,focus=true)=>{setSelected([id]);setSelectedEdge(null);if(focus)setFocusRevision(n=>n+1);setNotice('Clip added. Connect its input and output to include it in the story.');};
  const add=(kind:Exclude<NodeKind,'source'>,edgeId?:string,placement?:{x:number;y:number},fromId?:string)=>{
    if(!graph)return;const connection=graph.edges.find(e=>e.id===edgeId),before=graph.nodes.find(n=>n.id===(connection?.from??fromId??selected[0]));
    const {node,item}=createNode(kind,connection?.from??fromId);
    node.x=before?before.x+nodeDuration(before,items)*32+104:40;
    node.y=connection?before?.y??90:Math.max(90,...graph.nodes.map(n=>n.y))+145;
    if(placement){node.x=placement.x;node.y=placement.y;}
    let edges=graph.edges.filter(e=>e.id!==connection?.id);
    if(connection)edges=[...edges,{...connection,to:node.id,points:undefined},edge(node.id,connection.to)];
    let next=normalizeConditions({...graph,entryId:graph.entryId||node.id,nodes:[...graph.nodes,node],edges});if(fromId&&!connection)next=connect(next,fromId,node.id);
    change(!placement&&(connection||fromId)?autoLayout(next,[...items,item]):next,[item]);selectNew(node.id,!placement);jobs.select(item.id);
    if(placement)setNotice(connection?'Interstitial inserted into the connection.':fromId?'Interstitial attached to the clip.':'Interstitial placed. Drag its sockets to connect it.');
  };
  const patch=(id:string,patch:Partial<StoryNode>)=>{if(graph)change({...graph,nodes:graph.nodes.map(n=>n.id===id?{...n,...patch}:n)});};
  const toggleBehavior=(id:string,behavior:'loop'|'conditional',enabled:boolean)=>{if(graph)change(setBehavior(graph,id,behavior,enabled));};
  const updateConditions=(id:string,conditions:StoryCondition[])=>{if(!graph)return;
    change({...graph,nodes:graph.nodes.map(n=>n.id===id?{...n,conditions,defaultConditionId:conditions.some(c=>c.id===n.defaultConditionId)?n.defaultConditionId:conditions[0]?.id}:n),edges:graph.edges.flatMap(e=>{
      if(e.from!==id||e.event!=='answer')return [e];
      const condition=conditions.find(c=>c.id===(e.conditionId??e.id));
      return condition?[{...e,conditionId:condition.id,label:condition.label,values:condition.values}]:[];
    })});
  };
  const attach=(to:string)=>{if(graph&&connecting){change(connect(graph,connecting.from,to,connecting.edgeId));setConnecting(null);setNotice('Connection saved.');}};
  const disconnect=()=>{if(graph&&selectedEdge){change({...graph,edges:graph.edges.filter(e=>e.id!==selectedEdge)});setSelectedEdge(null);setNotice('Connection removed. Clips are retained.');}};
  const remove=()=>{player.pause();if(selectedGroup){ungroup(selectedGroup.id);return;}if(selectedEdge){disconnect();return;}if(graph&&selected.length){void projects.removeStoryNodes(selected);setConnecting(null);}};
  const duplicate=()=>{
    if(!graph||!selected.length)return;
    const chosen=graph.nodes.filter(n=>selected.includes(n.id)),remap=new Map(chosen.map(n=>[n.id,freshId()])),added:Interstitial[]=[];
    const internal=graph.edges.filter(e=>remap.has(e.from)&&remap.has(e.to)),rows=[...chosen.map(n=>n.y),...internal.flatMap(e=>(e.points??[]).map(p=>p.y))];
    const offsetY=selectedGroup?Math.max(...rows)-Math.min(...rows)+200:160;
    const nodes=chosen.map(originalNode=>{const n={...originalNode,conditions:conditionsFor(graph,originalNode)};const original=items.find(i=>i.id===n.interstitialId);const itemId=original?freshId():undefined;
      if(original){const result=playableResult(original);added.push({...original,id:itemId!,label:`${original.label} copy`,phase:result?'ready':'draft',result,requestPrompt:result?.prompt??(original.phase==='ready'?original.requestPrompt:undefined),requestId:undefined,previousResult:undefined,error:undefined});}
      return {...n,id:remap.get(n.id)!,name:`${n.name} copy`,interstitialId:itemId,referenceId:remap.get(n.referenceId??'')??n.referenceId,y:n.y+offsetY};});
    const edges=internal.map(e=>({...e,conditionId:e.event==='answer'?e.conditionId??e.id:undefined,id:freshId(),from:remap.get(e.from)!,to:remap.get(e.to)!,points:e.points?.map(p=>({...p,id:freshId(),y:p.y+offsetY}))}));
    const groups=copyGroups(graph,remap),next={...graph,nodes:[...graph.nodes,...nodes],edges:[...graph.edges,...edges],groups:[...(graph.groups??[]),...groups]};
    change(next,added);if(selectedGroup&&groups.length===1)selectGroup(groups[0].id,next);else setSelected(nodes.map(n=>n.id));setFocusRevision(n=>n+1);setNotice('Duplicated clips are disconnected from the original path.');
  };
  const split=(clipId?:string,atFrame?:number)=>{if(!graph)return;const id=clipId??selected[0],session=player.getSnapshot().flow;
    const frame=atFrame??(session?.sceneId===id?session.frame:0),result=splitClip(graph,items,id,frame);
    if(result.graph===graph){setNotice('Place the playhead inside a clip to split it.');return;}
    change(autoLayout(result.graph,[...items,...result.items]),result.items);setSelected([id]);setNotice('Clip split. Media is preserved; outgoing connections follow the second half.');};
  const insertTemplate=(template:string|StoryTemplate,connectionId?:string,placement?:{x:number;y:number},fromId?:string)=>{if(!graph)return;const t=typeof template==='string'?makePreset(template):template;
    const result=instantiateTemplate(graph,t,items,connectionId,placement);
    if(fromId&&!connectionId){result.graph=connect(result.graph,fromId,result.selectedId);if(!placement)result.graph=autoLayout(result.graph,[...items,...result.items]);}
    change(result.graph,result.items);selectGroup(result.groupId,result.graph);if(!placement)setFocusRevision(n=>n+1);setNotice(`${t.name} added as a group. Drag its header to move it.`);};
  const saveTemplate=(name:string)=>{if(!graph)return;const template=captureTemplate(graph,selected,items,name);if(!template){setNotice('Select clips or a group to save a template.');return;}
    const grouped=selectedGroup?{graph,group:selectedGroup}:groupClips(graph,selected,template.name,template.color);
    const next={...grouped.graph,templates:[...graph.templates,template]};change(next);if(grouped.group)selectGroup(grouped.group.id,next);setNotice(`Saved group to templates: ${template.name}`);};
  const rename=(id:string,name:string)=>{if(!graph)return;const node=graph.nodes.find(n=>n.id===id);if(!node)return;
    patch(id,{name:name.trim().slice(0,1000)||'Untitled'});};
  const importVideos=async(files:File[],position?:{x:number;y:number})=>{
    player.pause();const ids=await projects.importVideos(files,position);
    if(ids?.length){setSelected([ids[0]]);setSelectedEdge(null);jobs.select(null);if(!position)setFocusRevision(n=>n+1);setNotice(`Imported ${ids.length} video${ids.length===1?'':'s'} as separate clips.`);}
  };
  const addAsset=(assetId:string,position?:{x:number;y:number})=>{
    const asset=projects.getSnapshot().project?.library?.find(item=>item.assetId===assetId);
    if(!graph||!asset||asset.kind==='subtitle'||!asset.duration)return;
    if(graph.nodes.length>=1000){setNotice('A project can contain up to 1,000 clips.');return;}
    const node:StoryNode={id:freshId(),name:asset.name,kind:'source',source:{assetId,originalAssetId:asset.originalAssetId,duration:asset.duration,
      inFrame:asset.inFrame??0,outFrame:asset.outFrame??Math.max(1,Math.floor(asset.duration*TIMELINE_FPS))},
      x:position?.x??40,y:position?.y??Math.max(90,...graph.nodes.map(n=>n.y))+145,crossfadeStart:0,crossfadeEnd:0,loopCount:0};
    change({...graph,entryId:graph.entryId||node.id,nodes:[...graph.nodes,node]});setSelected([node.id]);setSelectedEdge(null);jobs.select(null);if(!position)setFocusRevision(n=>n+1);setNotice(`Added ${asset.name} as a separate clip.`);
  };
  return {graph,items,selected,selectedGroup,selectGroup,patchGroup,groupSelection,ungroup,selectedEdge,connecting,notice,focusRevision,inspectorRevision,selectConnection,select,selectNew,setSelected,setSelectedEdge,setConnecting,setNotice,change,add,patch,toggleBehavior,updateConditions,attach,disconnect,remove,duplicate,split,insertTemplate,saveTemplate,rename,
    selectedId:selectedGroup?null:selected[0]??null,importVideos,addAsset,projects,jobs,player};
}
export type StoryEditor=ReturnType<typeof useStoryEditor>;
