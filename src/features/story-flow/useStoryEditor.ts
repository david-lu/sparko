import { useEffect, useState } from 'react';
import { playableResult, type Interstitial } from '../../../shared/interstitials';
import type { ProjectController } from '../project/ProjectController';
import type { InterstitialController } from '../interstitials/InterstitialController';
import type { VideoPlayerController } from '../player/VideoPlayerController';
import { autoLayout, connect, createNode, edge, freshId, nodeDuration, splitClip, type NodeKind, type StoryGraph, type StoryNode, type StoryTemplate } from './model';
import { captureTemplate, instantiateTemplate, makePreset } from './templates';
import { TIMELINE_FPS } from '../../../shared/constants';

export function useStoryEditor(graph:StoryGraph|undefined,items:Interstitial[],projects:ProjectController,jobs:InterstitialController,player:VideoPlayerController) {
  const [selected,setSelected]=useState<string[]>([]),[selectedEdge,setSelectedEdge]=useState<string|null>(null),[connecting,setConnecting]=useState<{from:string;edgeId?:string}|null>(null);
  const [notice,setNotice]=useState(''),[focusRevision,setFocusRevision]=useState(0),[inspectorRevision,setInspectorRevision]=useState(0);
  const source=projects.getSnapshot().source;
  useEffect(()=>{setSelected([]);setSelectedEdge(null);setConnecting(null);setNotice('');},[source]);
  const selectConnection=(id:string)=>{setSelectedEdge(id);setSelected([]);jobs.select(null);setInspectorRevision(n=>n+1);};
  useEffect(()=>{setSelected(ids=>ids.filter(id=>graph?.nodes.some(n=>n.id===id)));setSelectedEdge(id=>graph?.edges.some(e=>e.id===id)?id:null);setConnecting(null);},[graph?.entryId,graph?.nodes.length,projects.getSnapshot().historyRevision]);
  const change=(next:StoryGraph,added:Interstitial[]=[])=>{player.pause();projects.updateStoryFlow(next,added);};
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
    if(connection)edges=[...edges,{...connection,to:node.id,points:undefined},edge(node.id,connection.to,kind==='conditional'?'fallback':'next',kind==='conditional'?'Otherwise':'Next')];
    if(kind==='conditional'&&!connection)edges=[...edges,edge(node.id,node.id,'fallback','Otherwise: repeat')];
    let next={...graph,nodes:[...graph.nodes,node],edges};if(fromId&&!connection)next=connect(next,fromId,node.id);
    change(!placement&&(connection||fromId)?autoLayout(next,[...items,item]):next,[item]);selectNew(node.id,!placement);jobs.select(item.id);
    if(placement)setNotice(connection?'Interstitial inserted into the connection.':fromId?'Interstitial attached to the clip.':'Interstitial placed. Drag its sockets to connect it.');
  };
  const patch=(id:string,patch:Partial<StoryNode>)=>{if(graph)change({...graph,nodes:graph.nodes.map(n=>n.id===id?{...n,...patch}:n)});};
  const setKind=(id:string,kind:Exclude<NodeKind,'source'>)=>{
    if(!graph)return;const node=graph.nodes.find(n=>n.id===id);if(!node||node.kind==='source')return;
    const outgoing=graph.edges.filter(e=>e.from===id&&e.to!==id),next=outgoing[0];
    const edges=graph.edges.filter(e=>e.from!==id);
    if(kind==='conditional'){
      outgoing.forEach((e,index)=>edges.push({...e,event:'answer',label:e.event==='answer'?e.label:`Choice ${index+1}`}));
      edges.push(edge(id,id,'fallback','Otherwise: repeat'));
    }else if(next)edges.push({...next,event:'next',label:'Next',values:[]});
    change({...graph,nodes:graph.nodes.map(n=>n.id===id?{...n,kind}:n),edges});
  };
  const attach=(to:string)=>{if(graph&&connecting){change(connect(graph,connecting.from,to,connecting.edgeId));setConnecting(null);setNotice('Connection saved.');}};
  const disconnect=()=>{if(graph&&selectedEdge){change({...graph,edges:graph.edges.filter(e=>e.id!==selectedEdge)});setSelectedEdge(null);setNotice('Connection removed. Clips are retained.');}};
  const remove=()=>{player.pause();if(selectedEdge){disconnect();return;}if(graph&&selected.length){void projects.removeStoryNodes(selected);setConnecting(null);}};
  const duplicate=()=>{
    if(!graph||!selected.length)return;
    const chosen=graph.nodes.filter(n=>selected.includes(n.id)),remap=new Map(chosen.map(n=>[n.id,freshId()])),added:Interstitial[]=[];
    const nodes=chosen.map(n=>{const original=items.find(i=>i.id===n.interstitialId);const itemId=original?freshId():undefined;
      if(original){const result=playableResult(original);added.push({...original,id:itemId!,label:`${original.label} copy`,phase:result?'ready':'draft',result,requestId:undefined,previousResult:undefined,error:undefined});}
      return {...n,id:remap.get(n.id)!,name:`${n.name} copy`,interstitialId:itemId,referenceId:remap.get(n.referenceId??'')??n.referenceId,y:n.y+160};});
    const edges=graph.edges.filter(e=>remap.has(e.from)&&remap.has(e.to)).map(e=>({...e,id:freshId(),from:remap.get(e.from)!,to:remap.get(e.to)!}));
    change({...graph,nodes:[...graph.nodes,...nodes],edges:[...graph.edges,...edges]},added);setSelected(nodes.map(n=>n.id));setFocusRevision(n=>n+1);setNotice('Duplicated clips are disconnected from the original path.');
  };
  const split=(clipId?:string,atFrame?:number)=>{if(!graph)return;const id=clipId??selected[0],session=player.getSnapshot().flow;
    const frame=atFrame??(session?.sceneId===id?session.frame:0),result=splitClip(graph,items,id,frame);
    if(result.graph===graph){setNotice('Place the playhead inside a clip to split it.');return;}
    change(autoLayout(result.graph,[...items,...result.items]),result.items);setSelected([id]);setNotice('Clip split. Media is preserved; outgoing connections follow the second half.');};
  const insertTemplate=(template:string|StoryTemplate,connectionId?:string,placement?:{x:number;y:number},fromId?:string)=>{if(!graph)return;const t=typeof template==='string'?makePreset(template):template;
    const result=instantiateTemplate(graph,t,items,connectionId,placement);
    if(fromId&&!connectionId){result.graph=connect(result.graph,fromId,result.selectedId);if(!placement)result.graph=autoLayout(result.graph,[...items,...result.items]);}
    change(result.graph,result.items);selectNew(result.selectedId,!placement);jobs.select(result.graph.nodes.find(n=>n.id===result.selectedId)?.interstitialId??null);setNotice(`${t.name} inserted as editable clips.`);};
  const saveTemplate=(name:string)=>{if(!graph)return;const template=captureTemplate(graph,selected,items,name);if(!template){setNotice('Select one or more interstitial clips to save a template.');return;}
    change({...graph,templates:[...graph.templates,template]});setNotice(`Saved template: ${template.name}`);};
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
    change({...graph,nodes:[...graph.nodes,node]});setSelected([node.id]);setSelectedEdge(null);jobs.select(null);if(!position)setFocusRevision(n=>n+1);setNotice(`Added ${asset.name} as a separate clip.`);
  };
  return {graph,items,selected,selectedEdge,connecting,notice,focusRevision,inspectorRevision,selectConnection,select,selectNew,setSelected,setSelectedEdge,setConnecting,setNotice,change,add,patch,setKind,attach,disconnect,remove,duplicate,split,insertTemplate,saveTemplate,rename,
    selectedId:selected[0]??null,importVideos,addAsset,projects,jobs,player};
}
export type StoryEditor=ReturnType<typeof useStoryEditor>;
