import { newAssetGeneration, generationBusy, type AssetGeneration, type MediaKind } from '../../../shared/asset-generation';
import { assetPlacement } from '../project/migrateClipMedia';
import { DEFAULT_IMAGE_DURATION } from '../../media/stillImage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { playableResult, type Interstitial } from '../../../shared/interstitials';
import type { ProjectController } from '../project/ProjectController';
import type { InterstitialController } from '../interstitials/InterstitialController';
import type { VideoPlayerController } from '../player/VideoPlayerController';
import { autoLayout, connect, createNode, edge, freshId, nodeDuration, splitClip, withReferenceFade, type CommentAnchor, type NodeKind, type StoryComment, type StoryGraph, type StoryNode, type StoryTemplate, type StoryGroup } from './model';
import { COMMENT_LIMIT, COMMENT_TEXT_LIMIT, splitComments } from './comments';
import { captureTemplate, instantiateTemplate, makePreset } from './templates';
import { groupClips, copyGroups, setGroupMembers } from './groups';
import { conditionsFor, normalizeConditions, setBehavior } from './behaviors';
import type { StoryCondition } from './model';
import { INTERSTITIAL, TIMELINE_FPS } from '../../../shared/constants';
import { ClipGenerationController } from '../project/ClipGenerationController';
import { joinClips, joinProblems } from './joinClips';
import type { ClipColor } from './clipColors';
export type LibrarySelection = { type: 'asset' | 'generation' | 'job'; id: string };

export function useStoryEditor(graph:StoryGraph|undefined,items:Interstitial[],projects:ProjectController,jobs:InterstitialController,player:VideoPlayerController) {
  const [librarySelections, setLibrarySelections] = useState<LibrarySelection[]>([]);
  const project = projects.getSnapshot().project;
  useEffect(() => {
    setLibrarySelections(old => {
      const next = old.filter(s => s.type === 'asset' ? project?.library?.some(a => a.assetId === s.id) : s.type === 'generation' ? project?.clipGenerations?.some(g => g.id === s.id) : items.some(i => i.id === s.id));
      return next.length === old.length ? old : next;
    });
  }, [project?.library, project?.clipGenerations, items]);
  const librarySelection = librarySelections.at(-1) ?? null;
  const [clipDrag,setClipDrag]=useState<{id:string;overStart:boolean}|null>(null);
  const [clipJobs] = useState(() => new ClipGenerationController(projects));
  useEffect(() => clipJobs.watch(), [clipJobs]);
  const [selected,setSelection]=useState<string[]>([]),[selectedGroupId,setSelectedGroupId]=useState<string|null>(null),[selectedEdge,setSelectedEdge]=useState<string|null>(null),[connecting,setConnecting]=useState<{from:string;edgeId?:string;conditionId?:string}|null>(null);
  const [removingClips,setRemovingClips]=useState(false);
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
  const change=(next:StoryGraph,added:Interstitial[]=[],generations:AssetGeneration[]=[])=>{player.pause();projects.updateStoryFlow(next,added,generations);};
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
  const groupSelection=(name=`Group ${(graph?.groups?.length??0)+1}`)=>{if(!graph)return;const result=groupClips(graph,selected,name);if(!result.group)return;change(result.graph);selectGroup(result.group.id,result.graph);setNotice('Group created. Drag its header to move it. Right-click for group actions.');};
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
  const addMedia=(kind:MediaKind,placement?:{x:number;y:number},edgeId?:string,fromId?:string)=>{
    if(!graph)return;
    if(kind==='video'){add('simple',edgeId,placement,fromId);return;}
    const generation=newAssetGeneration(kind,undefined,project?.loras);
    const node:StoryNode={id:freshId(),name:generation.name,kind:'source',mediaKind:kind,generationId:generation.id,volume:1,
      duration:kind==='image'?DEFAULT_IMAGE_DURATION:generation.settings.duration??4,loopCount:0,x:placement?.x??40,y:placement?.y??Math.max(90,...graph.nodes.map(n=>n.y))+145};
    const connection=graph.edges.find(e=>e.id===edgeId),nodes=[...graph.nodes,node];
    let next={...graph,entryId:graph.entryId||node.id,nodes,edges:graph.edges.filter(e=>e.id!==edgeId)};
    if(connection)next.edges.push({...connection,to:node.id,points:undefined},edge(node.id,connection.to));
    else if(fromId)next=connect(next,fromId,node.id);
    change(next,[],[generation]);selectNew(node.id,!placement);
  };
  const makeGenerative=(nodeId:string)=>{
    const node=graph?.nodes.find(n=>n.id===nodeId);if(!node||node.interstitialId)return;
    const kind=node.source?.kind??node.mediaKind??'video';
    if(kind==='video'){
      const previous=project?.clipGenerations?.find(g=>g.id===node.generationId);
      if(previous&&generationBusy(previous))return;
      const {item}=createNode(node.loop?'looped':'simple');
      const saved=project?.library?.find(a=>a.assetId===node.source?.assetId)?.generation;
      item.label=node.name;item.prompt=previous?.settings.prompt??saved?.settings?.prompt??(saved?.provider==='comfy'?saved.result.prompt:undefined)??'';
      item.duration=Math.max(INTERSTITIAL.minDuration,Math.min(INTERSTITIAL.maxDuration,previous?.settings.duration??nodeDuration(node,items)));
      item.useInputReference=false;item.useOutputReference=false;item.startReferenceType='none';item.endReferenceType='none';
      const images=previous?.settings.references.filter(r=>r.kind==='image');
      if(images?.length){item.imageReferences=images.map(({assetId,name})=>({assetId,name}));item.startReferenceType='image';item.startImageIndex=0;}
      change({...graph!,nodes:graph!.nodes.map(n=>n.id===nodeId?{...n,kind:node.loop?'looped':'simple',mediaKind:'video',generationId:undefined,interstitialId:item.id}:n)},[item]);
      jobs.select(item.id);return;
    }
    if(node.generationId)return;
    const generation=newAssetGeneration(kind,undefined,project?.loras);
    generation.name=node.name;
    if(kind==='image'&&node.source)generation.settings.references=[{assetId:node.source.assetId,name:node.name,kind:'image'}];
    change({...graph!,nodes:graph!.nodes.map(n=>n.id===nodeId?{...n,generationId:generation.id,mediaKind:kind}:n)},[],[generation]);
  };
  const replaceAsset=(nodeId:string,assetId:string)=>{
    if(!graph)return;
    const asset=project?.library?.find(asset=>asset.assetId===assetId),node=graph.nodes.find(node=>node.id===nodeId);
    if(!asset||!node)return;
    const source=assetPlacement(asset,nodeDuration(node,items));
    projects.endHistoryGroup();change({...graph,nodes:graph.nodes.map(n=>n.id===nodeId?{...n,source,trim:undefined}:n)});projects.endHistoryGroup();
  };
  const patch=(id:string,patch:Partial<StoryNode>)=>{if(!graph)return;const next={...graph,nodes:graph.nodes.map(n=>n.id===id?{...n,...patch}:n)};if(Object.keys(patch).every(key=>key==='volume'))projects.updateStoryFlow(next);else change(next);};
  const colorClips=(color:ClipColor)=>{
    if(!graph||!selected.length)return;
    projects.endHistoryGroup();
    change({...graph,nodes:graph.nodes.map(node=>selected.includes(node.id)?{...node,color}:node)});
    projects.endHistoryGroup();
  };
  const toggleBehavior=(id:string,behavior:'loop'|'conditional',enabled:boolean)=>{if(graph)change(setBehavior(graph,id,behavior,enabled));};
  const updateConditions=(id:string,conditions:StoryCondition[])=>{if(!graph)return;
    change({...graph,nodes:graph.nodes.map(n=>n.id===id?{...n,conditions,defaultConditionId:conditions.some(c=>c.id===n.defaultConditionId)?n.defaultConditionId:conditions[0]?.id}:n),edges:graph.edges.flatMap(e=>{
      if(e.from!==id||e.event!=='answer')return [e];
      const condition=conditions.find(c=>c.id===(e.conditionId??e.id));
      return condition?[{...e,conditionId:condition.id,label:condition.label,values:condition.values}]:[];
    })});
  };
  const attach=(to:string)=>{if(graph&&connecting){change(connect(graph,connecting.from,to,connecting.edgeId,connecting.conditionId));setConnecting(null);setNotice('Connection saved.');}};
  const disconnect=()=>{if(graph&&selectedEdge){change({...graph,edges:graph.edges.filter(e=>e.id!==selectedEdge)});setSelectedEdge(null);setNotice('Connection removed. Clips are retained.');}};
  const remove=()=>{if(removingClips)return;player.pause();if(selectedGroup){ungroup(selectedGroup.id);return;}if(selectedEdge){disconnect();return;}if(graph&&selected.length){setRemovingClips(true);const projectId=project?.id;void (async()=>{try{
      for(const node of graph.nodes.filter(n=>selected.includes(n.id))){
        const generation=projects.getSnapshot().project?.clipGenerations?.find(g=>g.id===node.generationId);
        if(generation&&(generationBusy(generation)||generation.phase==='error'&&generation.requestId)){
          await clipJobs.cancel(generation.id);if(projects.getSnapshot().project?.id!==projectId)return;
          const cancelled=projects.getSnapshot().project?.clipGenerations?.find(g=>g.id===generation.id);
          if(cancelled?.phase!=='cancelled'){setNotice(cancelled?.error??'Unable to cancel this generation. Try deleting the clip again.');return;}
        }
      }
      if(projects.getSnapshot().project?.id===projectId)await projects.removeStoryNodes(selected);
    }finally{setRemovingClips(false);}})();setConnecting(null);}};
  const duplicate=()=>{
    if(!graph)return;
    if(selectedGroup&&!selectedGroup.nodeIds.length&&selectedGroup.bounds){const group={...selectedGroup,id:freshId(),name:`${selectedGroup.name} copy`.slice(0,200),bounds:{...selectedGroup.bounds,y:selectedGroup.bounds.y+160}},next={...graph,groups:[...(graph.groups??[]),group]};change(next);selectGroup(group.id,next);setFocusRevision(n=>n+1);return;}
    if(!selected.length)return;
    const chosen=graph.nodes.filter(n=>selected.includes(n.id)),remap=new Map(chosen.map(n=>[n.id,freshId()])),added:Interstitial[]=[],generations:AssetGeneration[]=[];
    const internal=graph.edges.filter(e=>remap.has(e.from)&&remap.has(e.to)),rows=[...chosen.map(n=>n.y),...internal.flatMap(e=>(e.points??[]).map(p=>p.y))];
    const offsetY=selectedGroup?Math.max(...rows)-Math.min(...rows)+200:160;
    const nodes=chosen.map(originalNode=>{const n={...originalNode,conditions:conditionsFor(graph,originalNode)};const original=items.find(i=>i.id===n.interstitialId);const itemId=original?freshId():undefined;
      if(original){const result=playableResult(original);added.push({...original,lora:original.lora??null,id:itemId!,label:`${original.label} copy`,phase:result?'ready':'draft',result,requestPrompt:result?.prompt??(original.phase==='ready'?original.requestPrompt:undefined),requestId:undefined,previousResult:undefined,error:undefined});}
      const recipe=project?.clipGenerations?.find(g=>g.id===n.generationId);
      const generation=recipe?{...structuredClone(recipe),id:freshId(),name:`${n.name} copy`,phase:n.source?'ready' as const:'draft' as const,requestId:undefined,submitted:undefined,error:undefined}:undefined;
      if(generation)generations.push(generation);
      return {...n,generationId:generation?.id,id:remap.get(n.id)!,name:`${n.name} copy`,interstitialId:itemId,referenceId:remap.get(n.referenceId??'')??n.referenceId,y:n.y+offsetY};});
    const edges=internal.map(e=>({...e,conditionId:e.event==='answer'?e.conditionId??e.id:undefined,id:freshId(),from:remap.get(e.from)!,to:remap.get(e.to)!,points:e.points?.map(p=>({...p,id:freshId(),y:p.y+offsetY}))}));
    const groups=copyGroups(graph,remap,offsetY),next={...graph,nodes:[...graph.nodes,...nodes],edges:[...graph.edges,...edges],groups:[...(graph.groups??[]),...groups]};
    change(next,added,generations);if(selectedGroup&&groups.length===1)selectGroup(groups[0].id,next);else setSelected(nodes.map(n=>n.id));setFocusRevision(n=>n+1);setNotice('Duplicated clips are disconnected from the original path.');
  };
  const split=(clipId?:string,atFrame?:number)=>{if(!graph)return false;const id=clipId??selected[0],session=player.getSnapshot().flow;
    const frame=atFrame??(session?.sceneId===id?session.frame:0),result=splitClip(graph,items,id,frame);
    if(result.graph===graph){setNotice('Place the playhead inside a clip to split it.');return false;}
    const generations:AssetGeneration[]=[];
    result.graph.nodes=result.graph.nodes.map(n=>{
      if(graph.nodes.some(old=>old.id===n.id)||!n.generationId)return n;
      const recipe=project?.clipGenerations?.find(g=>g.id===n.generationId);if(!recipe)return n;
      const copy={...structuredClone(recipe),id:freshId(),name:n.name,phase:n.source?'ready' as const:'draft' as const,requestId:undefined,submitted:undefined,error:undefined};generations.push(copy);return {...n,generationId:copy.id};
    });
    const next=result.rightId?splitComments(result.graph,id,result.rightId):result.graph;
    change(autoLayout(next,[...items,...result.items]),result.items,generations);setSelected([id]);setNotice('Clip split. Media is preserved; outgoing connections follow the second half.');return true;};
  const addComment=(anchor:CommentAnchor,text:string,color?:ClipColor)=>{
    const value=text.trim().slice(0,COMMENT_TEXT_LIMIT);if(!graph||!value)return;
    if((graph.comments?.length??0)>=COMMENT_LIMIT){setNotice(`A project can contain up to ${COMMENT_LIMIT.toLocaleString()} comments.`);return;}
    const id=freshId();
    projects.endHistoryGroup();change({...graph,comments:[...graph.comments??[],{id,text:value,createdAt:Date.now(),anchor,...(color?{color}:{})}]});projects.endHistoryGroup();
    setNotice('Comment added. Drag its pin to move it; Undo removes it.');return id;
  };
  const updateComment=(id:string,patch:Partial<Pick<StoryComment,'text'|'resolved'|'anchor'|'color'>>)=>{
    const comment=graph?.comments?.find(c=>c.id===id);if(!graph||!comment)return;
    const next={...comment,...patch,...(patch.text!==undefined?{text:patch.text.trim().slice(0,COMMENT_TEXT_LIMIT)||comment.text}:{})};
    if(JSON.stringify(next)===JSON.stringify(comment))return;
    // Only pin nudges merge into one undo step.
    const nudge=Object.keys(patch).every(key=>key==='anchor');
    if(!nudge)projects.endHistoryGroup();change({...graph,comments:graph.comments!.map(c=>c.id===id?next:c)});if(!nudge)projects.endHistoryGroup();
  };
  const removeComment=(id:string)=>{
    if(!graph?.comments?.some(c=>c.id===id))return;
    projects.endHistoryGroup();change({...graph,comments:graph.comments.filter(c=>c.id!==id)});projects.endHistoryGroup();
    setNotice('Comment deleted. Undo restores it.');
  };
  const projectBusy=projects.getSnapshot().busy;
  const joinReasons=useMemo(()=>[...(graph?joinProblems(graph,items,selected):['Open a project and select at least two clips to join.']),
    ...(project?.clipGenerations?.some(g=>generationBusy(g)&&graph?.nodes.some(n=>selected.includes(n.id)&&n.generationId===g.id))?['Wait for selected clips to finish generating before joining.']:[]),
    ...(projectBusy?['Wait for the current project operation to finish before joining clips.']:[])],[graph,items,selected,projectBusy,project?.clipGenerations]);
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
    change(result.graph,result.items,result.generations);selectGroup(result.groupId,result.graph);if(!placement)setFocusRevision(n=>n+1);setNotice(`${t.name} added as a group. Drag its header to move it.`);};
  const saveTemplate=(name:string)=>{if(!graph)return;const template=captureTemplate(graph,selected,items,name,project?.clipGenerations);if(!template){setNotice('Select clips or a group to save a template.');return;}
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
  return {graph,items,selected,selectedGroup,selectGroup,patchGroup,groupSelection,changeGroupMembers,removeFromGroup,ungroup,selectedEdge,connecting,notice,focusRevision,inspectorRevision,selectConnection,select,selectNew,revealClip,setSelected,setSelectedEdge,setConnecting,setNotice,change,add,patch,toggleBehavior,updateConditions,attach,disconnect,remove,duplicate,split,insertTemplate,saveTemplate,rename,
    selectedId:selectedGroup?null:selected[0]??null,importVideos,addAsset,projects,jobs,player,librarySelection,librarySelections,selectLibrary,clipJobs,setStartVideo,setStartAsset,clipDrag,setClipDrag,join,joinReasons,captureFrame,capturingFrame,colorClips,addMedia,replaceAsset,makeGenerative,removingClips,addComment,updateComment,removeComment};
}
export type StoryEditor=ReturnType<typeof useStoryEditor>;
