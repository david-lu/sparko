import { useEffect, useMemo, useRef, useState } from 'react';
import { playableResult, type Interstitial } from '../../../shared/interstitials';
import type { ProjectController } from '../project/ProjectController';
import type { InterstitialController } from '../interstitials/InterstitialController';
import type { VideoPlayerController } from '../player/VideoPlayerController';
import { autoLayout, connect, createNode, edge, freshId, nodeDuration, splitClip, withReferenceFade, type GroupBounds, type NodeKind, type StoryGraph, type StoryNode, type StoryTemplate, type StoryGroup } from './model';
import { captureTemplate, instantiateTemplate, makePreset } from './templates';
import { groupClips, copyGroups, setGroupMembers } from './groups';
import { conditionsFor, normalizeConditions, setBehavior } from './behaviors';
import type { StoryCondition } from './model';
import { TIMELINE_FPS } from '../../../shared/constants';
import { AssetGenerationController } from '../project/AssetGenerationController';
import { joinClips, joinProblems } from './joinClips';
export type LibrarySelection = { type: 'asset' | 'generation' | 'job'; id: string };

export function useStoryEditor(graph:StoryGraph|undefined,items:Interstitial[],projects:ProjectController,jobs:InterstitialController,player:VideoPlayerController) {
  const [librarySelections, setLibrarySelections] = useState<LibrarySelection[]>([]);
  const project = projects.getSnapshot().project;
  useEffect(() => {
    setLibrarySelections(old => {
      const next = old.filter(s => s.type === 'asset' ? project?.library?.some(a => a.assetId === s.id) : s.type === 'generation' ? project?.assetGenerations?.some(g => g.id === s.id) : items.some(i => i.id === s.id));
      return next.length === old.length ? old : next;
    });
  }, [project?.library, project?.assetGenerations, items]);
  const librarySelection = librarySelections.at(-1) ?? null;
  const [clipDrag,setClipDrag]=useState<{id:string;overStart:boolean}|null>(null);
  const [assetJobs] = useState(() => new AssetGenerationController(projects));
  useEffect(() => assetJobs.watch(), [assetJobs]);
  const [selected,setSelection]=useState<string[]>([]),[selectedGroupId,setSelectedGroupId]=useState<string|null>(null),[selectedEdge,setSelectedEdge]=useState<string|null>(null),[connecting,setConnecting]=useState<{from:string;edgeId?:string}|null>(null);
  const [notice,setNotice]=useState(''),[focusRevision,setFocusRevision]=useState(0),[inspectorRevision,setInspectorRevision]=useState(0);
  const joinedClip=useRef<string|null>(null);
  useEffect(()=>{const id=joinedClip.current;if(!id)return;joinedClip.current=null;
    const frame=requestAnimationFrame(()=>player.seekFlowScene(id,0));return()=>cancelAnimationFrame(frame);
  },[graph,player]);
  const activationRevision=projects.getSnapshot().activationRevision;
  const selectedGroup=graph?.groups?.find(g=>g.id===selectedGroupId);
  const setSelected=(value:string[]|((ids:string[])=>string[]))=>{setLibrarySelections([]);setSelectedGroupId(null);setSelection(value);};
  const selectLibrary = (selection: LibrarySelection | LibrarySelection[]) => { setLibrarySelections(Array.isArray(selection) ? selection : [selection]); setSelection([]); setSelectedGroupId(null); setSelectedEdge(null); jobs.select(null); setInspectorRevision(n => n + 1); };
  const [capturingFrame, setCapturingFrame] = useState(false);
  const capturePending = useRef(false);
  const captureFrame = async () => {
    const state = projects.getSnapshot(), project = state.project;
    if (!project || state.busy || capturePending.current) return;
    capturePending.current = true; setCapturingFrame(true);
    try {
      const playback = player.getSnapshot();
      const node = project.storyFlow?.nodes.find(node => node.id === playback.flow?.sceneId);
      const label = (node?.name ?? project.source.name).replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 180) || 'Video';
      const frame = Math.floor(playback.flow?.frame ?? playback.time * TIMELINE_FPS) + 1;
      const base = `${label} frame ${frame}`;
      let name = `${base}.png`, suffix = 2;
      while (project.library?.some(asset => asset.name === name)) name = `${base} (${suffix++}).png`;
      const blob = await player.captureFrame();
      if (projects.getSnapshot().activationRevision !== state.activationRevision || projects.getSnapshot().project?.id !== project.id) throw new Error('Project changed while capturing the frame. Capture it again in the current project.');
      const file = new File([blob], name, { type: 'image/png' });
      const [asset] = await projects.importAssets([{ file, path: name }]);
      if (asset) { selectLibrary({ type: 'asset', id: asset.assetId }); setNotice('Frame saved as an image in Library.'); }
    } finally { capturePending.current = false; setCapturingFrame(false); }
  };
  useEffect(()=>{setSelected([]);setSelectedEdge(null);setConnecting(null);setNotice('');},[activationRevision]);
  const selectConnection=(id:string)=>{setSelectedEdge(id);setSelected([]);jobs.select(null);setInspectorRevision(n=>n+1);};
  useEffect(()=>{setSelection(ids=>ids.filter(id=>graph?.nodes.some(n=>n.id===id)));setSelectedGroupId(id=>graph?.groups?.some(g=>g.id===id)?id:null);setSelectedEdge(id=>graph?.edges.some(e=>e.id===id)?id:null);setConnecting(null);},[graph?.entryId,graph?.nodes.length,graph?.groups?.length,projects.getSnapshot().historyRevision]);
  const change=(next:StoryGraph,added:Interstitial[]=[])=>{player.pause();projects.updateStoryFlow(next,added);};
  const setStartVideo=(id:string)=>{
    const current=projects.getSnapshot().project?.storyFlow;
    if(!current||projects.getSnapshot().busy||current.entryId===id||!current.nodes.some(n=>n.id===id))return;
    projects.endHistoryGroup();change({...current,entryId:id});projects.endHistoryGroup();
    setNotice('Start video updated. Playback begins here.');
  };
  const setStartAsset=async(assetId:string)=>{
    const state=projects.getSnapshot(),project=state.project;
    if(!project?.storyFlow||state.busy)throw new Error('Wait for the current operation to finish.');
    const asset=project.library?.find(a=>a.assetId===assetId);
    if(!asset||!['video','generated','image'].includes(asset.kind))throw new Error('Choose a video or image from Library.');
    const matches=project.storyFlow.nodes.filter(n=>{
      const item=project.interstitials.find(i=>i.id===n.interstitialId),result=item&&playableResult(item);
      return n.source?.assetId===assetId||result?.assetId===assetId||result?.fullAssetId===assetId;
    });
    if(matches.length>1)throw new Error('Several timeline clips use this video. Drag the specific clip from the timeline.');
    if(matches.length){setStartVideo(matches[0].id);return;}
    player.pause();projects.endHistoryGroup();
    const ids=await projects.importLibraryAsset(assetId,undefined,true);projects.endHistoryGroup();
    if(!ids?.length)throw new Error(projects.getSnapshot().error??'Unable to add the start video.');
    setNotice('Video added to the timeline as the start.');
  };
  const selectGroup=(id:string,next=graph)=>{const group=next?.groups?.find(g=>g.id===id);if(!group)return;setLibrarySelections([]);setSelectedGroupId(id);setSelection(group.nodeIds);setSelectedEdge(null);jobs.select(null);setInspectorRevision(n=>n+1);};
  const patchGroup=(id:string,patch:Partial<Pick<StoryGroup,'name'|'color'|'bounds'>>)=>{if(graph)change({...graph,groups:graph.groups?.map(g=>g.id===id?{...g,...patch,name:patch.name?.trim().slice(0,200)||g.name}:g)});};
  const createGroup=(ids:string[],bounds?:GroupBounds,name=`Group ${(graph?.groups?.length??0)+1}`)=>{if(!graph)return;const result=groupClips(graph,ids,name,'blue',bounds);if(!result.group)return;change(result.graph);selectGroup(result.group.id,result.graph);setNotice('Group created. Drag its header to move it. Right-click for group actions.');};
  const groupSelection=(name?:string)=>createGroup(selected,undefined,name);
  const changeGroupMembers=(id:string,ids:string[])=>{if(!graph)return;const next=setGroupMembers(graph,id,ids,items);change(next);selectGroup(id,next);setNotice('Group updated. Clips and connections are preserved.');};
  const removeFromGroup=(id:string,ids:string[])=>{const group=graph?.groups?.find(g=>g.id===id);if(group)changeGroupMembers(id,group.nodeIds.filter(n=>!ids.includes(n)));};
  const ungroup=(id=selectedGroup?.id)=>{if(!graph)return;const groups=graph.groups?.filter(g=>id?g.id!==id:!g.nodeIds.some(n=>selected.includes(n)));change({...graph,groups});setSelectedGroupId(null);setNotice('Group removed. Clips and connections are preserved. Undo restores the frame.');};
  const select=(id:string,frame:number|null=0,multiple=false)=>{
    setSelected(ids=>multiple?ids.includes(id)?ids.filter(value=>value!==id):[...ids,id]:[id]);setSelectedEdge(null);
    jobs.select(graph?.nodes.find(n=>n.id===id)?.interstitialId??null);
    if(!multiple&&frame!==null)player.seekFlowScene(id,frame);
  };
  const selectNew=(id:string,focus=true)=>{setSelected([id]);setSelectedEdge(null);if(focus)setFocusRevision(n=>n+1);setNotice('Clip added. Connect its input and output to include it in the story.');};
  const revealClip=(id:string)=>{select(id,null);setFocusRevision(n=>n+1);};
  const add=(kind:Exclude<NodeKind,'source'>,edgeId?:string,placement?:{x:number;y:number},fromId?:string)=>{
    if(!graph)return;const connection=graph.edges.find(e=>e.id===edgeId),before=graph.nodes.find(n=>n.id===(connection?.from??fromId??selected[0]));
    const {node,item}=createNode(kind,connection?.from??fromId);
    item.useInputReference=!!(connection||fromId);
    item.useOutputReference=!!connection;
    item.startReferenceType=item.useInputReference?'video':'none';
    item.endReferenceType=item.useOutputReference?'video':'none';
    node.x=before?before.x+nodeDuration(before,items)*32+104:40;
    node.y=connection?before?.y??90:Math.max(90,...graph.nodes.map(n=>n.y))+145;
    if(placement){node.x=placement.x;node.y=placement.y;}
    const nodes=[...graph.nodes,node];
    let edges=graph.edges.filter(e=>e.id!==connection?.id);
    if(connection)edges=[...edges,withReferenceFade({...connection,to:node.id,points:undefined},nodes),withReferenceFade(edge(node.id,connection.to),nodes)];
    let next=normalizeConditions({...graph,entryId:graph.entryId||node.id,nodes,edges});if(fromId&&!connection)next=connect(next,fromId,node.id);
    change(!placement&&(connection||fromId)?autoLayout(next,[...items,item]):next,[item]);selectNew(node.id,!placement);jobs.select(item.id);
    if(placement)setNotice(connection?'Video inserted into the connection.':fromId?'Video attached to the clip.':'Video placed. Drag its sockets to connect it.');
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
    if(!graph)return;
    if(selectedGroup&&!selectedGroup.nodeIds.length&&selectedGroup.bounds){const group={...selectedGroup,id:freshId(),name:`${selectedGroup.name} copy`.slice(0,200),bounds:{...selectedGroup.bounds,y:selectedGroup.bounds.y+160}},next={...graph,groups:[...(graph.groups??[]),group]};change(next);selectGroup(group.id,next);setFocusRevision(n=>n+1);return;}
    if(!selected.length)return;
    const chosen=graph.nodes.filter(n=>selected.includes(n.id)),remap=new Map(chosen.map(n=>[n.id,freshId()])),added:Interstitial[]=[];
    const internal=graph.edges.filter(e=>remap.has(e.from)&&remap.has(e.to)),rows=[...chosen.map(n=>n.y),...internal.flatMap(e=>(e.points??[]).map(p=>p.y))];
    const offsetY=selectedGroup?Math.max(...rows)-Math.min(...rows)+200:160;
    const nodes=chosen.map(originalNode=>{const n={...originalNode,conditions:conditionsFor(graph,originalNode)};const original=items.find(i=>i.id===n.interstitialId);const itemId=original?freshId():undefined;
      if(original){const result=playableResult(original);added.push({...original,lora:original.lora??null,id:itemId!,label:`${original.label} copy`,phase:result?'ready':'draft',result,requestPrompt:result?.prompt??(original.phase==='ready'?original.requestPrompt:undefined),requestId:undefined,previousResult:undefined,error:undefined});}
      return {...n,id:remap.get(n.id)!,name:`${n.name} copy`,interstitialId:itemId,referenceId:remap.get(n.referenceId??'')??n.referenceId,y:n.y+offsetY};});
    const edges=internal.map(e=>({...e,conditionId:e.event==='answer'?e.conditionId??e.id:undefined,id:freshId(),from:remap.get(e.from)!,to:remap.get(e.to)!,points:e.points?.map(p=>({...p,id:freshId(),y:p.y+offsetY}))}));
    const groups=copyGroups(graph,remap,offsetY),next={...graph,nodes:[...graph.nodes,...nodes],edges:[...graph.edges,...edges],groups:[...(graph.groups??[]),...groups]};
    change(next,added);if(selectedGroup&&groups.length===1)selectGroup(groups[0].id,next);else setSelected(nodes.map(n=>n.id));setFocusRevision(n=>n+1);setNotice('Duplicated clips are disconnected from the original path.');
  };
  const split=(clipId?:string,atFrame?:number)=>{if(!graph)return false;const id=clipId??selected[0],session=player.getSnapshot().flow;
    const frame=atFrame??(session?.sceneId===id?session.frame:0),result=splitClip(graph,items,id,frame);
    if(result.graph===graph){setNotice('Place the playhead inside a clip to split it.');return false;}
    change(autoLayout(result.graph,[...items,...result.items]),result.items);setSelected([id]);setNotice('Clip split. Media is preserved; outgoing connections follow the second half.');return true;};
  const projectBusy=projects.getSnapshot().busy;
  const joinReasons=useMemo(()=>[...(graph?joinProblems(graph,items,selected):['Open a project and select at least two clips to join.']),
    ...(projectBusy?['Wait for the current project operation to finish before joining clips.']:[])],[graph,items,selected,projectBusy]);
  const join=()=>{
    if(joinReasons.length||!graph)return joinReasons;
    const result=joinClips(graph,items,selected);if(!result.ok)return result.reasons;
    joinedClip.current=result.nodeId;
    projects.endHistoryGroup();change(result.graph);projects.endHistoryGroup();
    select(result.nodeId,null);setConnecting(null);setFocusRevision(n=>n+1);
    setNotice(`${result.count} clips joined. The clip spans the first start through the last end, including footage between trims. Undo restores the original clips.`);
    return null;
  };
  const insertTemplate=(template:string|StoryTemplate,connectionId?:string,placement?:{x:number;y:number},fromId?:string)=>{if(!graph)return;const t=typeof template==='string'?makePreset(template):template;
    const result=instantiateTemplate(graph,t,items,connectionId,placement);
    if(fromId&&!connectionId){
      if(typeof template==='string'){
        const entry=result.graph.nodes.find(node=>node.id===result.selectedId),item=result.items.find(item=>item.id===entry?.interstitialId);
        if(item){item.useInputReference=true;item.startReferenceType='video';}
      }
      result.graph=connect(result.graph,fromId,result.selectedId);if(!placement)result.graph=autoLayout(result.graph,[...items,...result.items]);
    }
    change(result.graph,result.items);selectGroup(result.groupId,result.graph);if(!placement)setFocusRevision(n=>n+1);setNotice(`${t.name} added as a group. Drag its header to move it.`);};
  const saveTemplate=(name:string)=>{if(!graph)return;const template=captureTemplate(graph,selected,items,name);if(!template){setNotice('Select clips or a group to save a template.');return;}
    const grouped=selectedGroup?{graph,group:selectedGroup}:groupClips(graph,selected,template.name,template.color);
    const next={...grouped.graph,templates:[...graph.templates,template]};change(next);if(grouped.group)selectGroup(grouped.group.id,next);setNotice(`Saved group to templates: ${template.name}`);};
  const rename=(id:string,name:string)=>{if(!graph)return;const node=graph.nodes.find(n=>n.id===id);if(!node)return;
    patch(id,{name:name.trim().slice(0,1000)||'Untitled'});};
  const importVideos=async(files:File[],position?:{x:number;y:number})=>{
    player.pause();const ids=await projects.importVideos(files,position);
    if(ids?.length){setSelected([ids[0]]);setSelectedEdge(null);jobs.select(null);if(!position)setFocusRevision(n=>n+1);setNotice(`Imported ${ids.length} clip${ids.length===1?'':'s'} as separate clips.`);}
  };
  const addAsset=async(assetId:string,position?:{x:number;y:number})=>{
    player.pause();
    const ids=await projects.importLibraryAsset(assetId,position);
    if(ids?.length){setSelected([ids[0]]);setSelectedEdge(null);jobs.select(null);if(!position)setFocusRevision(n=>n+1);setNotice('Added clip from the library.');}
  };
  return {graph,items,selected,selectedGroup,selectGroup,patchGroup,createGroup,groupSelection,changeGroupMembers,removeFromGroup,ungroup,selectedEdge,connecting,notice,focusRevision,inspectorRevision,selectConnection,select,selectNew,revealClip,setSelected,setSelectedEdge,setConnecting,setNotice,change,add,patch,toggleBehavior,updateConditions,attach,disconnect,remove,duplicate,split,insertTemplate,saveTemplate,rename,
    selectedId:selectedGroup?null:selected[0]??null,importVideos,addAsset,projects,jobs,player,librarySelection,librarySelections,selectLibrary,assetJobs,setStartVideo,setStartAsset,clipDrag,setClipDrag,join,joinReasons,captureFrame,capturingFrame};
}
export type StoryEditor=ReturnType<typeof useStoryEditor>;
