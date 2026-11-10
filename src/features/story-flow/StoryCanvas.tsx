import { generationBusy } from '../../../shared/asset-generation';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Combine, Copy, Flag, Hand, GripVertical, ImageOff, LayoutTemplate, Maximize, MessageSquare, MessageSquarePlus, Minus, Paintbrush, Palette, Plus, Scissors, SquareDashed, Trash2, Unplug, Upload } from 'lucide-react';
import { videoAssets } from '../../../shared/video-references';
import { DEFAULT_IMAGE_DURATION } from '../../media/stillImage';
import { TIMELINE_FPS } from '../../../shared/constants';
import { isGenerating, playableResult } from '../../../shared/interstitials';
import { formatTime } from '../../../shared/contracts';
import type { CallResponseFlow, PlaybackSession } from '../call-response/model';
import { sceneFrames, flowLayout } from '../call-response/model';
import { assets } from '../project/assets';
import ImageDrawingDialog from '../project/ImageDrawingDialog';
import { useAssetAvailability } from '../project/useAssetAvailability';
import ContentIssues, { type ContentIssue } from '../../shared/ContentIssues';
import { storyGenerationItem } from './referenceInputs';
import VideoFilmstrip from '../timeline/VideoFilmstrip';
import ClipLoading, { ClipJobStatus } from '../../shared/ClipLoading';
import ResizeHandle from '../../shared/ResizeHandle';
import ModalBackdrop from '../../shared/ModalBackdrop';
import { useWorkspaceLocked } from '../../shared/panels/WorkspaceLock';
import { useShortcuts } from '../../shared/shortcuts';
import { useExclusiveMenu } from '../../shared/DropdownMenu';
import { phaseLabel } from '../interstitials/status';
import { autoLayout, CLIP_HEIGHT, connect, createNode, freshId, nodeDuration, nodeMediaLayout, nodeVisualBounds, PIXELS_PER_SECOND, reachableNodes, groupColors, type CommentAnchor, type GroupBounds, type StoryComment, type StoryNode, type StoryEdge } from './model';
import { clipAnchor, commentSceneFrame, commentSummary, isClipAnchor } from './comments';
import CommentPopover from './CommentPopover';
import './comments.css';
import type { StoryEditor } from './useStoryEditor';
import { builtInTemplates, instantiateTemplate, makePreset } from './templates';
import { STORY_DRAG_TYPE, readLibraryDrag, type LibraryItem } from './libraryDrag';
import { edgeVelocity, fitCamera, gridSpacing, minimumRowScale, toScreen, toWorld, zoomAt, type Camera, type Point } from './viewport';
import { linkGeometry } from './links';
import { connectionReference } from './references';
import { referenceHighlights } from './referenceHighlights';
import { connectionColor, fadeRegionShape, transitionRegions } from './transitionRegions';
import { sceneMediaRange, playheadTime } from './mediaRange';
import { clipTrimRange, trimClip, trimPreviewScene, type TrimSide } from './trimming';
import type { PlayheadTimeMode } from '../../shared/preferences';
import { insertIntoConnection } from './insertIntoConnection';
import { groupFrame, moveClips, moveGroup } from './groups';
import { behaviors, outputPorts, outputOffset, type OutputPort } from './behaviors';
import { clipColors, clipColorName, type ClipColor } from './clipColors';
import ClipTypeIcon from './ClipTypeIcon';
import './styles.css';
import AudioLayers from '../project/AudioLayersEditor';
import { audioTrackAssetIds } from '../../../shared/audio-tracks';
import './groups.css';

/** Pins show their opening words until the timeline is zoomed far out. */
const PIN_LABEL_ZOOM=.5,PIN_LABEL_MAX=180,PIN_LABEL_MIN=72,PLAYHEAD_SNAP=8;
const sameAnchor=(a:CommentAnchor|null,b:CommentAnchor|null)=>a===b||!!a&&!!b&&JSON.stringify(a)===JSON.stringify(b);

export default function StoryCanvas({editor,flow,session,height,maxHeight,onHeight,collapsed,onCollapsed,pinchZoomSensitivity,playheadTimeMode,sourceDuration}:{editor:StoryEditor;flow:CallResponseFlow;session:PlaybackSession|null;height:number;maxHeight:number;onHeight:(height:number)=>void;collapsed:boolean;onCollapsed:(collapsed:boolean)=>void;pinchZoomSensitivity:number;playheadTimeMode:PlayheadTimeMode;sourceDuration?:number}) {
  const canvasId=useId(),workspaceLocked=useWorkspaceLocked();
  const shortcuts=useShortcuts();
  const videoInput=useRef<HTMLInputElement>(null),[fileDrag,setFileDrag]=useState(false);
  const graph=editor.graph!,scroll=useRef<HTMLDivElement>(null),root=useRef<HTMLDivElement>(null);
  useAssetAvailability([
    ...editor.projects.getSnapshot().project?.clipGenerations?.flatMap(g => g.settings.references.map(ref => ref.assetId)) ?? [],
    ...flow.scenes.filter(scene=>!scene.draft).map(scene=>sceneMediaRange(scene,flow.fps).assetId),
    ...graph.nodes.flatMap(node=>{
      const saved=editor.items.find(item=>item.id===node.interstitialId); if(!saved)return [];
      const item=storyGenerationItem(saved,node);
      return [...(item.timelineVideos??[]).filter(v=>v.enabled&&v.video).map(v=>v.video!.assetId), ...(item.imageReferences??[]).filter(ref=>ref.enabled!==false).map(ref=>ref.assetId),...(item.keyframes??[]).flatMap(k=>k.image?[k.image.assetId]:[]),...audioTrackAssetIds(item.inputAudioTracks?.filter(t=>!t.muted)),...(item.useInputReference&&item.useStartVideoAsset?videoAssets(item,'start').map(ref=>ref.assetId):[]),...(item.useOutputReference&&item.useEndVideoAsset&&item.method!=='comfy-loop'?videoAssets(item,'end').map(ref=>ref.assetId):[])];
    }),
  ]);
  const [camera,setCamera]=useState<Camera>({x:0,y:0,zoom:1,rowScale:1}),cameraRef=useRef(camera),[size,setSize]=useState({width:800,height:280}),[drag,setDrag]=useState<Record<string,Point>|null>(null);
  const [templateName,setTemplateName]=useState<string|null>(null),[follow,setFollow]=useState(false);
  const [joinError,setJoinError]=useState<string[]|null>(null);
  const [drawing,setDrawing]=useState<string>();
  const [wire,setWire]=useState<{anchor:string;reverse?:boolean;edgeId?:string;conditionId?:string;x:number;y:number}|null>(null);
  const [panTool,setPanTool]=useState(false),[spaceHeld,setSpaceHeld]=useState(false),space=useRef({held:false,used:false}),[panning,setPanning]=useState(false);
  const [marquee,setMarquee]=useState<{start:Point;end:Point}|null>(null),gestureCancel=useRef<(()=>void)|null>(null);
  const [trimPreview,setTrimPreview]=useState<{node:StoryNode;side:TrimSide}|null>(null);
  const [hoveredConnection,setHoveredConnection]=useState<string|null>(null);
  const pendingTrimSeek=useRef<{id:string;frame:number}|null>(null);
  useEffect(()=>{const pending=pendingTrimSeek.current;if(!pending)return;pendingTrimSeek.current=null;
    const frame=requestAnimationFrame(()=>editor.player.seekFlowScene(pending.id,pending.frame));return()=>cancelAnimationFrame(frame);
  },[flow]);
  const [cutTool,setCutTool]=useState(false),[cutPreview,setCutPreview]=useState<{id:string;frame:number}|null>(null);
  const [commentTool,setCommentTool]=useState(false),[commentEditor,setCommentEditor]=useState<{id:string|null;anchor:CommentAnchor;color?:ClipColor}|null>(null),[commentDrag,setCommentDrag]=useState<{id:string|null;anchor:CommentAnchor}|null>(null);
  const [commentGhost,setCommentGhost]=useState<CommentAnchor|null>(null),lastPointer=useRef<Point|null>(null);
  const [groupTool,setGroupTool]=useState(false),[drawnGroup,setDrawnGroup]=useState<GroupBounds|null>(null),[framePreview,setFramePreview]=useState<{id:string;bounds:GroupBounds}|null>(null);
  const [context,setContext]=useState<{id?:string;groupId?:string;edgeId?:string;pointId?:string;selectionIds?:string[];colors?:boolean;templates?:boolean;commentAnchor?:CommentAnchor;x:number;y:number;point:Point}|null>(null),menu=useRef<HTMLDivElement>(null);
  const suppressClick=useRef(false),lastFocusRevision=useRef(editor.focusRevision);
  const [movePreview,setMovePreview]=useState<{ids:string[];groupId?:string;dx:number;dy:number}|null>(null);
  const [routeDrag,setRouteDrag]=useState<{edgeId:string;pointId:string;point:Point}|null>(null);
  const [dropTarget,setDropTarget]=useState<string|null>(null),[dropPoint,setDropPoint]=useState<Point|null>(null),[libraryDrag,setLibraryDrag]=useState<LibraryItem|null>(null);
  const insertingLibrary=!!libraryDrag&&!('assetId' in libraryDrag);
  const movingInterstitial=!!movePreview&&!movePreview.groupId&&movePreview.ids.length===1&&graph.nodes.some(n=>n.id===movePreview.ids[0]&&n.kind!=='source');
  const dropConnection=insertingLibrary||movingInterstitial?graph.edges.find(e=>e.id===dropTarget):undefined;
  const project=editor.projects.getSnapshot().project,library=project?.library;
  useEffect(()=>{setDrawing(undefined);setCommentEditor(null);},[project?.id]);
  const comments=graph.comments??[];
  // Undo or another edit can remove the comment being edited.
  useEffect(()=>{if(commentEditor?.id&&!graph.comments?.some(c=>c.id===commentEditor.id))setCommentEditor(null);},[graph.comments,commentEditor?.id]);
  const templatePreview=useMemo(()=>{
    if(!libraryDrag||!('templateId' in libraryDrag))return;
    const template=graph.templates.find(t=>t.id===libraryDrag.templateId)??(builtInTemplates.some(t=>t.id===libraryDrag.templateId)?makePreset(libraryDrag.templateId):undefined);
    if(template)return instantiateTemplate({version:1,entryId:'',nodes:[],edges:[],templates:[]},template,[],undefined,{x:0,y:0});
  },[libraryDrag,graph.templates]);
  const dragPreview=useMemo(()=>{
    if(!libraryDrag)return [];
    if('mediaKind' in libraryDrag)return [{id:'draft',name:libraryDrag.mediaKind==='image'?'Image':libraryDrag.mediaKind==='video'?'Video':'Audio',kind:'source',x:0,y:0,duration:libraryDrag.mediaKind==='image'?DEFAULT_IMAGE_DURATION:4,color:'gray' as const}];
    if('kind' in libraryDrag){const {node,item}=createNode(libraryDrag.kind);return [{...node,x:0,y:0,duration:nodeDuration(node,[item])}];}
    if('assetId' in libraryDrag){const asset=library?.find(a=>a.assetId===libraryDrag.assetId);return asset && (asset.duration || asset.kind === 'image')?[{id:asset.assetId,name:asset.name,kind:'source',color:'gray' as const,x:0,y:0,duration:((asset.outFrame??(asset.duration??DEFAULT_IMAGE_DURATION)*TIMELINE_FPS)-(asset.inFrame??0))/TIMELINE_FPS}]:[];}
    return templatePreview?.graph.nodes.map(n=>({...n,duration:nodeDuration(n,templatePreview.items)}))??[];
  },[libraryDrag,templatePreview,library]);
  useEffect(()=>{
    const start=(event:DragEvent)=>{if(event.dataTransfer)setLibraryDrag(readLibraryDrag(event.dataTransfer));};
    const end=()=>{setFileDrag(false);setLibraryDrag(null);setDropTarget(null);setDropPoint(null);};
    window.addEventListener('dragstart',start);window.addEventListener('dragend',end);window.addEventListener('drop',end);
    return()=>{window.removeEventListener('dragstart',start);window.removeEventListener('dragend',end);window.removeEventListener('drop',end);};
  },[]);
  const hovering=useRef(false);
  const reached=useMemo(()=>reachableNodes(graph),[graph]);
  const orphaned=graph.nodes.filter(node=>!reached.has(node.id));
  const previewNodes=useMemo(()=>graph.nodes.map(node=>trimPreview?.node.id===node.id?trimPreview.node:node),[graph.nodes,trimPreview]);
  const durations=Object.fromEntries(previewNodes.map(n=>[n.id,nodeDuration(n,editor.items)]));
  const layouts=useMemo(()=>Object.fromEntries(previewNodes.map(n=>[n.id,nodeMediaLayout(n,editor.items)])),[previewNodes,editor.items]);
  const previewFlow=useMemo(()=>trimPreview?{...flow,scenes:flow.scenes.map(scene=>scene.id===trimPreview.node.id?trimPreviewScene(scene,trimPreview.node,editor.items):scene)}:flow,[flow,trimPreview,editor.items]);
  const references=useMemo(()=>Object.fromEntries(graph.edges.map(edge=>[edge.id,connectionReference(flow,flow.edges.find(e=>e.id===edge.id)!)])),[flow,graph.edges]);
  const connectionColors=Object.fromEntries(graph.edges.map(edge=>[edge.id,connectionColor({
    mismatch:references[edge.id].state==='mismatch',selected:editor.selectedEdge===edge.id,hovered:hoveredConnection===edge.id,
    traversed:!!session?.traversedEdgeIds.includes(edge.id),dropTarget:dropConnection?.id===edge.id,
  })]));
  const regions=useMemo(()=>transitionRegions(previewFlow,graph.edges,layouts),[previewFlow,graph.edges,layouts]);
  const assetAliases=editor.projects.getSnapshot().project?.assetAliases;
  const selectedGenerations=useMemo(()=>editor.items.filter(item=>graph.nodes.some(node=>node.interstitialId===item.id&&editor.selected.includes(node.id))
    ||editor.librarySelections.some(selection=>selection.type==='job'?selection.id===item.id:selection.type==='asset'&&[playableResult(item)?.assetId,playableResult(item)?.fullAssetId].includes(selection.id))),
  [graph.nodes,editor.items,editor.selected,editor.librarySelections]);
  const highlights=useMemo(()=>referenceHighlights(previewFlow,selectedGenerations.map(item=>({item,node:graph.nodes.find(node=>node.interstitialId===item.id),
    reference:playableResult(item)?undefined:editor.jobs.dependency(item.id)?.reference})),layouts,assetAliases),
  [previewFlow,graph.nodes,selectedGenerations,editor.jobs,layouts,assetAliases]);
  const clipLeft=(n:StoryNode)=>n.x-layouts[n.id].before*PIXELS_PER_SECOND;
  const clipRight=(n:StoryNode)=>n.x+(layouts[n.id].body+layouts[n.id].after)*PIXELS_PER_SECOND;
  const rowBounds=(n:StoryNode)=>({left:clipLeft(n),right:clipRight(n),top:n.y,...nodeVisualBounds(graph,n)});
  const frameAt=(node:StoryNode,x:number,bounds:{left:number;width:number})=>Math.round(((x-bounds.left)/bounds.width*layouts[node.id].total-layouts[node.id].before)*flow.fps);
  const nodes=previewNodes.map(n=>drag?.[n.id]?{...n,...drag[n.id]}:n);
  const {zoom}=camera,gridX=gridSpacing(zoom),gridY=gridSpacing(camera.rowScale);
  const clipRects=nodes.map(node=>({id:node.id,left:clipLeft(node)*zoom+camera.x,right:clipRight(node)*zoom+camera.x,top:node.y*camera.rowScale+camera.y,bottom:node.y*camera.rowScale+camera.y+CLIP_HEIGHT}));
  const intersects=(a:{left:number;right:number;top:number;bottom:number},b:typeof a)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  const conditionLabelWidth=(node:StoryNode)=>{
    if(!behaviors(node).conditional||zoom<.75||(clipRight(node)-clipLeft(node))*zoom<66)return 0;
    const rect=clipRects.find(r=>r.id===node.id)!,bounds=nodeVisualBounds(graph,node);
    const area={left:rect.right,right:rect.right+116,top:rect.top+bounds.topOffset,bottom:rect.top+bounds.bottomOffset};
    const space=Math.min(100,...clipRects.filter(r=>r.id!==node.id&&intersects(area,r)).map(r=>r.left-rect.right-16));
    return space>=36?space:0;
  };
  const conditionLabelRects=nodes.flatMap(node=>{
    const width=conditionLabelWidth(node);if(!width)return [];
    const rect=clipRects.find(r=>r.id===node.id)!;
    return outputPorts(graph,node).map((_,index,ports)=>({left:rect.right+6,right:rect.right+16+width,top:rect.top+outputOffset(ports.length,index)-9,bottom:rect.top+outputOffset(ports.length,index)+9}));
  });
  const position=(id:string)=>nodes.find(n=>n.id===id)!;
  const updateCamera=(value:Camera|((current:Camera)=>Camera))=>{const next=typeof value==='function'?value(cameraRef.current):value;cameraRef.current=next;setCamera(next);};
  const localPoint=(client:Point)=>{const bounds=scroll.current!.getBoundingClientRect();return {x:client.x-bounds.left,y:client.y-bounds.top};};
  // Keep the clip (or a template's entry clip) centered under the pointer.
  // Clip height stays fixed even when the camera compresses the row spacing.
  const libraryOrigin=(point:Point)=>{
    const anchor=dragPreview.find(n=>n.id===templatePreview?.selectedId)??dragPreview[0],view=cameraRef.current;
    return anchor?{x:point.x-(anchor.x+anchor.duration*PIXELS_PER_SECOND/2)*view.zoom,y:point.y-anchor.y*view.rowScale-CLIP_HEIGHT/2}:point;
  };
  const chooseTool=(tool:'cut'|'group'|'pan'|'comment'|null)=>{
    gestureCancel.current?.();setCutTool(tool==='cut'&&!cutTool);setGroupTool(tool==='group'&&!groupTool);setPanTool(tool==='pan'&&!panTool);setCommentTool(tool==='comment'&&!commentTool);
    // Show where a comment would land straight away when the pointer is already over the timeline.
    setCommentGhost(tool==='comment'&&!commentTool&&hovering.current&&lastPointer.current?commentAnchorAt(lastPointer.current):null);
    setCutPreview(null);setDrawnGroup(null);editor.setConnecting(null);
  };
  const fit=(targets:StoryNode[]=nodes,maxZoom=2,edges=graph.edges)=>{
    if(!scroll.current?.clientWidth||!scroll.current.clientHeight)return;
    const ids=new Set(targets.map(n=>n.id)),points=edges.filter(e=>ids.has(e.from)&&ids.has(e.to)).flatMap(e=>e.points??[]);
    const frames=(graph.groups??[]).filter(g=>g.bounds&&(editor.selectedGroup?g.id===editor.selectedGroup.id:targets.length===nodes.length||g.nodeIds.length&&g.nodeIds.every(id=>ids.has(id)))).map(g=>g.bounds!);
    if(!targets.length&&!frames.length)return;
    const bounds={left:Math.min(...targets.map(clipLeft),...points.map(p=>p.x),...frames.map(b=>b.x)),right:Math.max(...targets.map(clipRight),...points.map(p=>p.x),...frames.map(b=>b.x+b.width)),
      top:Math.min(...targets.map(n=>n.y),...points.map(p=>p.y),...frames.map(b=>b.y)),bottom:Math.max(...targets.map(n=>n.y),...points.map(p=>p.y),...frames.map(b=>b.y+b.height))};
    const outputSpace=targets.some(n=>behaviors(n).conditional)?110:0;
    updateCamera(fitCamera(bounds,scroll.current.clientWidth-outputSpace,scroll.current.clientHeight,maxZoom,graph.groups?.some(g=>g.nodeIds.every(id=>ids.has(id))),targets.map(rowBounds)));
  };
  const fitSelected=()=>{const selected=nodes.filter(n=>editor.selected.includes(n.id));fit(selected.length||editor.selectedGroup?selected:nodes,selected.length?8:2);};
  const cleanup=()=>{
    const arranged=autoLayout(graph,editor.items,scroll.current?.clientHeight);editor.change(arranged);
    // Opening/Fit may have compressed the previous arrangement. Recheck the new
    // rows immediately, without changing horizontal zoom or the pan origin.
    updateCamera(current=>({...current,rowScale:Math.max(current.rowScale,minimumRowScale(arranged.nodes.map(rowBounds),current.zoom))}));
    editor.setNotice('Layout cleaned up.');
  };
  const focus=(id=editor.selectedId)=>{if(!id&&editor.selectedGroup){fit(nodes.filter(n=>editor.selectedGroup!.nodeIds.includes(n.id)));return;}const n=nodes.find(n=>n.id===id),view=scroll.current;if(!n||!view?.clientHeight)return;
    updateCamera(current=>({...current,x:view.clientWidth/2-((clipLeft(n)+clipRight(n))/2)*current.zoom,y:(view.clientHeight-CLIP_HEIGHT)/2-n.y*current.rowScale}));};
  const reveal=(id:string)=>{const n=nodes.find(n=>n.id===id),view=scroll.current;if(!n||!view)return;const p=toScreen({x:clipLeft(n),y:n.y},cameraRef.current);
    if(p.x+layouts[n.id].total*PIXELS_PER_SECOND*cameraRef.current.zoom<24||p.x>view.clientWidth-24||p.y+CLIP_HEIGHT<24||p.y>view.clientHeight-24)focus(id);};
  // Opening and fitting use the same readable spacing. Tall branches remain
  // pannable rather than overlapping again when a saved project is reopened.
  const openingFit=()=>fit(nodes),latestFit=useRef(openingFit),hasOpeningFit=useRef(false);latestFit.current=openingFit;
  useLayoutEffect(()=>{
    const view=scroll.current;if(!view)return;let opening=!hasOpeningFit.current,frame=0;
    const resize=()=>{if(!view.clientWidth||!view.clientHeight)return;setSize({width:view.clientWidth,height:view.clientHeight});
      // Let restored docked panels settle before the initial fit. Later resizes keep the user's view.
      if(opening){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!view.clientWidth||!view.clientHeight)return;opening=false;hasOpeningFit.current=true;latestFit.current();});}};
    const observer=new ResizeObserver(resize);observer.observe(view);resize();if(opening)latestFit.current();
    return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[]);
  useEffect(()=>{if(collapsed||lastFocusRevision.current===editor.focusRevision)return;lastFocusRevision.current=editor.focusRevision;focus();},[editor.focusRevision,collapsed]);
  useEffect(()=>()=>gestureCancel.current?.(),[]);
  useEffect(()=>{
    if(collapsed)return;
    const down=(event:KeyboardEvent)=>{
      const target=event.target as HTMLElement;
      if(target.closest('.story-edges [role="button"],.content-issues,.content-issues-popover'))return;
      const action=shortcuts.action(event);
      if(event.code!=='Space'||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||action&&action!=='play'||target.closest('input,textarea,select,video[controls],[role="menu"],[data-popup-menu][open],dialog,[role="dialog"]')||target.isContentEditable||!scroll.current?.contains(target)&&!hovering.current||target.closest('button,summary,[role="button"]')&&!hovering.current)return;
      event.preventDefault();event.stopImmediatePropagation();if(!event.repeat){space.current={held:true,used:false};setSpaceHeld(true);}
    };
    const up=(event:KeyboardEvent)=>{if(event.code!=='Space'||!space.current.held)return;event.preventDefault();if(!space.current.used&&shortcuts.action(event)==='play')editor.player.togglePlayback();space.current={held:false,used:false};setSpaceHeld(false);};
    const blur=()=>{space.current={held:false,used:false};setSpaceHeld(false);gestureCancel.current?.();};
    window.addEventListener('keydown',down,true);window.addEventListener('keyup',up,true);window.addEventListener('blur',blur);
    return()=>{window.removeEventListener('keydown',down,true);window.removeEventListener('keyup',up,true);window.removeEventListener('blur',blur);};
  },[editor.player,collapsed,shortcuts.bindings]);
  useExclusiveMenu(menu,!!context,()=>setContext(null),()=>scroll.current?.focus({preventScroll:true}));
  useLayoutEffect(()=>{
    if(!context||!menu.current)return;
    const surface=menu.current;
    const position=()=>{const bounds=surface.getBoundingClientRect();
      surface.style.left=`${Math.max(8,Math.min(context.x,window.innerWidth-bounds.width-8))}px`;
      surface.style.top=`${Math.max(8,Math.min(context.y,window.innerHeight-bounds.height-8))}px`;};
    position();const observer=new ResizeObserver(position);observer.observe(surface);
    window.addEventListener('resize',position);
    surface.querySelector<HTMLElement>('button:not(:disabled)')?.focus({preventScroll:true});
    return()=>{observer.disconnect();window.removeEventListener('resize',position);};
  },[context]);
  useEffect(()=>{
    if(collapsed||!follow||!session||!scroll.current||gestureCancel.current)return;
    const node=graph.nodes.find(n=>n.id===session.sceneId),view=scroll.current;if(!node)return;
    const p=toScreen({x:node.x+session.frame/flow.fps*PIXELS_PER_SECOND,y:node.y},cameraRef.current),margin=Math.min(70,view.clientWidth/4);
    let next=cameraRef.current;
    if(p.x<margin||p.x>view.clientWidth-margin)next={...next,x:next.x+view.clientWidth/3-p.x};
    if(p.y<30||p.y+CLIP_HEIGHT>view.clientHeight-20)next={...next,y:(view.clientHeight-CLIP_HEIGHT)/2-node.y*next.rowScale};
    if(next!==cameraRef.current)updateCamera(next);
  },[follow,session?.sceneId,session?.frame,graph,collapsed]);
  useEffect(()=>{
    const element=scroll.current;if(!element)return;
    const wheel=(event:WheelEvent)=>{
      event.preventDefault();const current=cameraRef.current,unit=event.deltaMode===1?16:event.deltaMode===2?element.clientHeight:1;
      if(event.ctrlKey||event.metaKey)updateCamera(zoomAt(current,current.zoom*Math.exp(-event.deltaY*unit*.002*pinchZoomSensitivity),localPoint({x:event.clientX,y:event.clientY})));
      else updateCamera({...current,x:current.x-(event.shiftKey&&!event.deltaX?event.deltaY:event.deltaX)*unit,y:current.y-(event.shiftKey&&!event.deltaX?0:event.deltaY)*unit});
    };
    element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);
  },[pinchZoomSensitivity]);
  useEffect(()=>{
    if(collapsed)return;
    const key=(event:KeyboardEvent)=>{
      const target=event.target as HTMLElement;if(event.defaultPrevented||event.isComposing||target.isContentEditable||target.closest('input,textarea,select,dialog,[role="dialog"],video[controls],audio[controls],[role="menu"],[data-popup-menu][open],.sidePanelSectionHeader,.asset-library,.asset-inspector,.dock-header,.dock-float-grip,.crossfade-curve-graph'))return;
      if(event.key==='Escape'){chooseTool(null);setTemplateName(null);setContext(null);return;}
      const action=shortcuts.action(event);
      if(!action)return;
      // Keep native button activation and keyboard navigation available.
      if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&['Enter','Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.code)&&target.closest('button,a,summary,[role="button"],[role="separator"],[role="slider"]'))return;
      const actions:Partial<Record<typeof action,()=>void>>={fit:fitSelected,layout:cleanup,duplicate:editor.duplicate,group:editor.groupSelection,ungroup:editor.ungroup,
        pan:()=>chooseTool('pan'),select:()=>chooseTool(null),comment:()=>chooseTool('comment'),
        add:()=>editor.add('simple'),split:()=>{if(editor.split()){setCutTool(false);setCutPreview(null);}},cut:()=>chooseTool('cut'),
        delete:()=>{const pin=target.closest<HTMLElement>('[data-comment-id]');if(pin){editor.removeComment(pin.dataset.commentId!);scroll.current?.focus({preventScroll:true});return;}const point=target.closest<HTMLElement>('[data-reroute-id]');if(point){const edge=point.closest('[data-edge-id]')?.getAttribute('data-edge-id');if(edge)removeReroute(edge,point.dataset.rerouteId!);}else if(editor.selected.length||editor.selectedGroup||editor.selectedEdge)editor.remove();}};
      if(actions[action]){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)actions[action]();}
    };window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
  },[editor,graph,collapsed,shortcuts.bindings]);
  const beginConnection=(event:React.PointerEvent<Element>,node:StoryNode,edgeId?:string,reverse=false,detachOnBlank=false,outlet?:OutputPort)=>{
    if(event.button!==0||panTool||space.current.held)return;event.preventDefault();event.stopPropagation();gestureCancel.current?.();suppressClick.current=false;
    const x=event.clientX,y=event.clientY,pointerId=event.pointerId;let moved=false;
    const targetElement=event.currentTarget;targetElement.setPointerCapture(pointerId);
    const move=(e:PointerEvent)=>{if(e.pointerId!==pointerId)return;moved ||= Math.hypot(e.clientX-x,e.clientY-y)>=5;if(!moved)return;
      setWire({anchor:node.id,reverse,edgeId,conditionId:outlet?.conditionId,...localPoint({x:e.clientX,y:e.clientY})});};
    const end=(e:PointerEvent)=>{if(e.pointerId!==pointerId)return;move(e);cancel();if(!moved)return;
      suppressClick.current=true;setTimeout(()=>{suppressClick.current=false;},0);
      const element=document.elementFromPoint(e.clientX,e.clientY),target=element?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
      const wrongSocket=element?.closest(reverse?'.story-port.input':'.story-port.output');
      if(target&&!wrongSocket){const socket=element?.closest<HTMLElement>('.story-port.output'),targetPort=reverse?outputPorts(graph,position(target)).find(p=>p.id===socket?.dataset.outputId):outlet;
        editor.change(connect(graph,reverse?target:node.id,reverse?node.id:target,reverse?targetPort?.edgeId:edgeId,targetPort?.conditionId));editor.setConnecting(null);editor.setNotice(edgeId?'Connection redirected.':'Connection saved.');}
      else if(!target&&edgeId&&detachOnBlank){editor.change({...graph,edges:graph.edges.filter(e=>e.id!==edgeId)});editor.setConnecting(null);editor.setNotice('Connection detached. Undo restores it.');}
    };
    const cancel=()=>{setWire(null);gestureCancel.current=null;if(targetElement.hasPointerCapture(pointerId))targetElement.releasePointerCapture(pointerId);
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',escape);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){suppressClick.current=true;setTimeout(()=>{suppressClick.current=false;},0);cancel();}};
    gestureCancel.current=cancel;window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',escape);
  };
  const beginInput=(event:React.PointerEvent<Element>,node:StoryNode)=>{
    const incoming=graph.edges.filter(e=>e.to===node.id),existing=incoming.find(e=>e.id===editor.selectedEdge)??incoming.at(-1);
    if(existing&&!event.shiftKey)beginConnection(event,position(existing.from),existing.id,false,true);
    else beginConnection(event,node,undefined,true);
  };
  const trackGesture=(event:React.PointerEvent<HTMLElement|SVGElement>,onMove:(point:Point)=>void,onCommit:(moved:boolean)=>void,onCancel:()=>void,autoPan:boolean|(()=>boolean)=false)=>{
    gestureCancel.current?.();event.preventDefault();event.stopPropagation();window.getSelection()?.removeAllRanges();
    const target=event.currentTarget,pointerId=event.pointerId,start={x:event.clientX,y:event.clientY};let point=start,moved=false,raf=0,last=performance.now();
    target.setPointerCapture(pointerId);
    const apply=()=>onMove(localPoint(point));
    const tick=(now:number)=>{
      const seconds=Math.min(.05,(now-last)/1000);last=now;
      if(autoPan&&(typeof autoPan!=='function'||autoPan())&&moved&&scroll.current){const p=localPoint(point),vx=edgeVelocity(p.x,scroll.current.clientWidth),vy=edgeVelocity(p.y,scroll.current.clientHeight);
        if(vx||vy){updateCamera(c=>({...c,x:c.x-vx*seconds,y:c.y-vy*seconds}));apply();}}
      raf=requestAnimationFrame(tick);
    };
    const move=(e:PointerEvent)=>{if(e.pointerId!==pointerId)return;point={x:e.clientX,y:e.clientY};moved ||= Math.hypot(point.x-start.x,point.y-start.y)>3;if(moved)apply();};
    const dispose=()=>{cancelAnimationFrame(raf);gestureCancel.current=null;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',escape);if(target.hasPointerCapture(pointerId))target.releasePointerCapture(pointerId);};
    const end=(e:PointerEvent)=>{if(e.pointerId!==pointerId)return;move(e);dispose();onCommit(moved);};
    const cancel=()=>{dispose();onCancel();};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();cancel();}};
    gestureCancel.current=cancel;window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',escape);
    if(autoPan)raf=requestAnimationFrame(tick);
  };
  const trimSourceDuration=(node:StoryNode)=>{
    return node.source?.duration??library?.find(asset=>asset.assetId===node.source?.assetId)?.duration
      ??(node.source?.assetId===editor.projects.getSnapshot().project?.source.assetId?sourceDuration:undefined);
  };
  const trimFrameOffset=(original:StoryNode,next:StoryNode)=>Math.round((next.x-original.x)/PIXELS_PER_SECOND*TIMELINE_FPS);
  const commitTrim=(original:StoryNode,next:StoryNode)=>{
    if(original===next)return;
    const current=editor.player.getSnapshot().flow;
    if(current?.sceneId===next.id){
      const after=clipTrimRange(next,editor.items);
      pendingTrimSeek.current={id:next.id,frame:Math.max(0,Math.min(after.outFrame-after.inFrame-1,current.frame-trimFrameOffset(original,next)))};
    }
    editor.projects.endHistoryGroup();
    editor.change({...graph,nodes:graph.nodes.map(node=>node.id===next.id?next:node)});
    editor.projects.endHistoryGroup();
    editor.setNotice('Clip trimmed. Drag either edge to adjust it; Undo restores the previous range.');
  };
  const dragTrim=(event:React.PointerEvent<HTMLButtonElement>,node:StoryNode,side:TrimSide)=>{
    if(event.button!==0||panTool||space.current.held||cutTool||groupTool)return;
    editor.player.pause();editor.select(node.id,null);event.currentTarget.focus({preventScroll:true});
    const originalCamera=cameraRef.current,origin=toWorld(localPoint({x:event.clientX,y:event.clientY}),originalCamera);
    const duration=trimSourceDuration(node),range=clipTrimRange(node,editor.items,duration),initial=side==='start'?range.inFrame:range.outFrame;
    let next=node;
    trackGesture(event,point=>{
      const frame=initial+(toWorld(point,cameraRef.current).x-origin.x)/PIXELS_PER_SECOND*TIMELINE_FPS;
      next=trimClip(node,editor.items,side,frame,duration);setTrimPreview({node:next,side});
    },()=>{setTrimPreview(null);commitTrim(node,next);},()=>{setTrimPreview(null);updateCamera(originalCamera);},true);
  };
  const trimKey=(event:React.KeyboardEvent<HTMLButtonElement>,node:StoryNode,side:TrimSide)=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();editor.select(node.id,null);
    const duration=trimSourceDuration(node),range=clipTrimRange(node,editor.items,duration),current=side==='start'?range.inFrame:range.outFrame;
    const image=(node.source?.kind??node.mediaKind)==='image';
    const frame=event.key==='Home'?(side==='start'?image?range.inFrame:0:range.inFrame+1):event.key==='End'?(side==='start'?range.outFrame-1:Number.isFinite(range.totalFrames)?range.totalFrames:range.outFrame)
      :current+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?10:1);
    commitTrim(node,trimClip(node,editor.items,side,frame,duration));
  };
  const displayedPoints=(connection:StoryEdge)=>(connection.points??[]).map(p=>{
    if(routeDrag?.pointId===p.id&&routeDrag.edgeId===connection.id)return {...p,...routeDrag.point};
    if(movePreview?.ids.includes(connection.from)&&movePreview.ids.includes(connection.to))return {...p,x:p.x+movePreview.dx,y:p.y+movePreview.dy};
    return p;
  });
  const inputPoint=(node:StoryNode)=>{
    const p=toScreen({x:clipLeft(node),y:node.y},camera);return {x:p.x,y:p.y+CLIP_HEIGHT/2};
  };
  const outputPoint=(node:StoryNode,edgeId?:string,conditionId?:string)=>{
    const ports=outputPorts(graph,node),index=Math.max(0,ports.findIndex(p=>edgeId?p.edgeId===edgeId:conditionId?p.conditionId===conditionId:p.id==='next'));
    const p=toScreen({x:clipRight(node),y:node.y},camera);return {x:p.x,y:p.y+(behaviors(node).conditional?outputOffset(ports.length,index):CLIP_HEIGHT/2)};
  };
  const displayedGraph={...graph,nodes,edges:graph.edges.map(e=>({...e,points:displayedPoints(e)}))};
  const groupViews=(graph.groups??[]).flatMap(group=>{
    const bounds=framePreview?.id===group.id?framePreview.bounds:movePreview?.groupId===group.id&&group.bounds?{...group.bounds,x:group.bounds.x+movePreview.dx,y:group.bounds.y+movePreview.dy}:group.bounds;
    const frame=groupFrame(displayedGraph,{...group,bounds},editor.items,camera);
    return frame?[{group,...frame}]:[];
  });
  const previewGroup=templatePreview?.graph.groups?.[0],previewFrame=dropPoint&&templatePreview&&previewGroup?groupFrame(templatePreview.graph,previewGroup,templatePreview.items,{...camera,...dropPoint}):undefined;
  const focusGroupName=(id:string)=>{editor.selectGroup(id);requestAnimationFrame(()=>{const input=document.getElementById('story-group-name') as HTMLInputElement|null;input?.focus();input?.select();});};
  const geometry=(connection:StoryEdge)=>{
    const from=position(connection.from),to=position(connection.to);
    const start=outputPoint(from,connection.id),end=inputPoint(to);
    const points=displayedPoints(connection);
    return {...linkGeometry(start,end,points.map(p=>toScreen(p,camera)),from.id===to.id),points};
  };
  // Only expose fade buttons when their fixed-size controls fit between clips and each other.
  const fadeButtons=new Set<string>(),fadeRects:{left:number;right:number;top:number;bottom:number}[]=[];
  if(zoom>=.75)for(const connection of graph.edges){
    if(connection.from===connection.to||!position(connection.from)||!position(connection.to))continue;
    const {middle}=geometry(connection),rect={left:middle.x-21,right:middle.x+21,top:middle.y-19,bottom:middle.y+19};
    if(clipRects.some(r=>intersects(rect,r))||conditionLabelRects.some(r=>intersects(rect,r))||fadeRects.some(r=>intersects(rect,r)))continue;
    fadeButtons.add(connection.id);fadeRects.push(rect);
  }
  const addReroute=(edgeId:string,point:Point)=>{
    const connection=graph.edges.find(e=>e.id===edgeId);if(!connection||(connection.points?.length??0)>=200)return;
    const points=[...(connection.points??[])],index=geometry(connection).insertionIndex(toScreen(point,camera));
    points.splice(index,0,{id:freshId(),...point});editor.change({...graph,edges:graph.edges.map(e=>e.id===edgeId?{...e,points}:e)});
    editor.setSelectedEdge(edgeId);editor.setSelected([]);
  };
  const removeReroute=(edgeId:string,pointId:string)=>editor.change({...graph,edges:graph.edges.map(e=>e.id===edgeId?{...e,points:e.points?.filter(p=>p.id!==pointId)}:e)});
  const dragReroute=(event:React.PointerEvent<SVGCircleElement>,connection:StoryEdge,point:NonNullable<StoryEdge['points']>[number])=>{
    if(event.button!==0)return;editor.setSelectedEdge(connection.id);editor.setSelected([]);
    const originalCamera=cameraRef.current;let final:Point=point;
    trackGesture(event,position=>{final=toWorld(position,cameraRef.current);setRouteDrag({edgeId:connection.id,pointId:point.id,point:final});},
      moved=>{setRouteDrag(null);if(moved)editor.change({...graph,edges:graph.edges.map(e=>e.id===connection.id?{...e,points:e.points?.map(p=>p.id===point.id?{...p,...final}:p)}:e)});},
      ()=>{setRouteDrag(null);updateCamera(originalCamera);},true);
  };
  const dragClips=(event:React.PointerEvent<HTMLButtonElement>,ids:string[],groupId?:string)=>{
    const originalCamera=cameraRef.current,origin=toWorld(localPoint({x:event.clientX,y:event.clientY}),originalCamera);
    const interstitial=!groupId&&ids.length===1&&graph.nodes.some(n=>n.id===ids[0]&&n.kind!=='source');
    const single=!groupId&&ids.length===1;
    let dx=0,dy=0,connectionId:string|undefined,overStart=false,overProject=false;
    const clear=()=>{setDrag(null);setMovePreview(null);setDropTarget(null);editor.setClipDrag(null);};
    trackGesture(event,point=>{const world=toWorld(point,cameraRef.current);dx=world.x-origin.x;dy=world.y-origin.y;
      setDrag(Object.fromEntries(graph.nodes.filter(n=>ids.includes(n.id)).map(n=>[n.id,{x:n.x+dx,y:n.y+dy}])));
      setMovePreview({ids,groupId,dx,dy});
      const bounds=scroll.current!.getBoundingClientRect();
      const targets=document.elementsFromPoint(point.x+bounds.left,point.y+bounds.top);
      overProject=single&&targets.some(el=>el.closest('.project-inspector'));
      overStart=single&&targets.some(el=>el.closest('[data-project-start-drop][data-disabled="false"]'));
      if(single)editor.setClipDrag(current=>current?.id===ids[0]&&current.overStart===overStart?current:{id:ids[0],overStart});
      connectionId=interstitial?targets
        .map(el=>el.closest('[data-edge-id]')?.getAttribute('data-edge-id'))
        .find(id=>graph.edges.some(e=>e.id===id&&!ids.includes(e.from)&&!ids.includes(e.to)))??undefined:undefined;
      setDropTarget(connectionId??null);
    },moved=>{clear();if(!moved)return;
      if(overStart){updateCamera(originalCamera);editor.setStartVideo(ids[0]);editor.setSelected([]);editor.setSelectedEdge(null);editor.jobs.select(null);return;}
      if(overProject){updateCamera(originalCamera);return;}
      let next=groupId?moveGroup(graph,groupId,Math.round(dx/8)*8,Math.round(dy/8)*8):moveClips(graph,ids,Math.round(dx/8)*8,Math.round(dy/8)*8);
      if(connectionId){next=insertIntoConnection(next,ids[0],connectionId);editor.setNotice('Video inserted into the connection.');}
      editor.change(next);
    },()=>{clear();updateCamera(originalCamera);},()=>!overProject);
  };
  const resizeGroup=(event:React.PointerEvent<HTMLButtonElement>,id:string)=>{
    if(event.button!==0||panTool||space.current.held)return;
    const frame=groupViews.find(g=>g.group.id===id)!;editor.selectGroup(id);
    const origin=toWorld({x:frame.left,y:frame.top},cameraRef.current),originalCamera=cameraRef.current;
    let bounds:GroupBounds={...origin,width:frame.width/zoom,height:frame.height/camera.rowScale};
    trackGesture(event,point=>{const end=toWorld(point,cameraRef.current);bounds={...origin,width:Math.max(96/cameraRef.current.zoom,end.x-origin.x),height:Math.max(64/cameraRef.current.rowScale,end.y-origin.y)};setFramePreview({id,bounds});},
      moved=>{setFramePreview(null);if(moved)editor.patchGroup(id,{bounds});},()=>{setFramePreview(null);updateCamera(originalCamera);},true);
  };
  const dragTitle=(event:React.PointerEvent<HTMLButtonElement>,node:StoryNode)=>{
    if(event.button!==0)return;
    if(editor.connecting){event.preventDefault();event.stopPropagation();editor.attach(node.id);return;}
    scroll.current?.focus({preventScroll:true});
    if(event.shiftKey){event.preventDefault();event.stopPropagation();editor.select(node.id,0,true);return;}
    const ids=!editor.selectedGroup&&editor.selected.includes(node.id)?editor.selected:[node.id];
    if(editor.selectedGroup||!editor.selected.includes(node.id))editor.select(node.id,session?.sceneId===node.id?session.frame:0);
    dragClips(event,ids);
  };
  const beginAreaGesture=(event:React.PointerEvent<HTMLDivElement>)=>{
    if((event.target as Element).closest('.content-issues,.content-issues-popover'))return;
    if(commentTool&&event.button===0&&!space.current.held&&!(event.target as Element).closest('[data-comment-id]')){
      event.preventDefault();event.stopPropagation();suppressClick.current=true;setTimeout(()=>{suppressClick.current=false;},0);
      setCommentTool(false);setCommentGhost(null);openCommentDraft(commentAnchorAt({x:event.clientX,y:event.clientY}));return;
    }
    const pan=event.button===1||event.button===0&&(panTool||space.current.held);
    const blank=!(event.target as Element).closest('[data-node-id],[data-edge-id],[data-group-id],button,input,textarea,select');
    if(!pan&&!(event.button===0&&(blank||groupTool)))return;
    event.currentTarget.focus({preventScroll:true});setContext(null);
    const start=localPoint({x:event.clientX,y:event.clientY}),originalCamera=cameraRef.current,originalSelection=editor.selected;
    if(pan){
      space.current.used=true;setPanning(true);
      trackGesture(event,point=>updateCamera({...originalCamera,x:originalCamera.x+point.x-start.x,y:originalCamera.y+point.y-start.y}),
        moved=>{setPanning(false);if(!moved&&blank){editor.setSelected([]);editor.setSelectedEdge(null);editor.setConnecting(null);editor.jobs.select(null);}},()=>{setPanning(false);updateCamera(originalCamera);});return;
    }
    if(groupTool){
      const origin=toWorld(start,originalCamera);let bounds:GroupBounds={...origin,width:0,height:0};
      const finish=()=>{setDrawnGroup(null);setGroupTool(false);};
      trackGesture(event,point=>{const end=toWorld(point,cameraRef.current);bounds={x:Math.min(origin.x,end.x),y:Math.min(origin.y,end.y),width:Math.abs(end.x-origin.x),height:Math.abs(end.y-origin.y)};setDrawnGroup(bounds);},
        moved=>{finish();if(!moved||bounds.width*cameraRef.current.zoom<32||bounds.height*cameraRef.current.rowScale<32)return;
          const ids=graph.nodes.filter(n=>clipLeft(n)>=bounds.x&&clipRight(n)<=bounds.x+bounds.width&&n.y>=bounds.y&&n.y+CLIP_HEIGHT/cameraRef.current.rowScale<=bounds.y+bounds.height).map(n=>n.id);
          editor.createGroup(ids,{...bounds,width:Math.max(bounds.width,96/cameraRef.current.zoom),height:Math.max(bounds.height,64/cameraRef.current.rowScale)});
        },()=>{finish();updateCamera(originalCamera);},true);return;
    }
    const origin=toWorld(start,originalCamera),additive=event.shiftKey,toggle=event.ctrlKey||event.metaKey;
    editor.setSelectedEdge(null);editor.setConnecting(null);
    trackGesture(event,point=>{
      const end=toWorld(point,cameraRef.current);setMarquee({start:origin,end});
      const left=Math.min(origin.x,end.x),right=Math.max(origin.x,end.x),top=Math.min(origin.y,end.y),bottom=Math.max(origin.y,end.y);
      const hits=graph.nodes.filter(n=>clipLeft(n)<right&&clipRight(n)>left&&n.y<bottom&&n.y+CLIP_HEIGHT/cameraRef.current.rowScale>top).map(n=>n.id);
      editor.setSelected(toggle?[...originalSelection.filter(id=>!hits.includes(id)),...hits.filter(id=>!originalSelection.includes(id))]:additive?[...new Set([...originalSelection,...hits])]:hits);
    },moved=>{setMarquee(null);if(!moved&&!additive&&!toggle){editor.setSelected([]);editor.jobs.select(null);}},
      ()=>{setMarquee(null);editor.setSelected(originalSelection);updateCamera(originalCamera);},true);
  };
  const scrubKey=(event:React.KeyboardEvent<HTMLElement>,node:StoryNode)=>{
    if(!['ArrowLeft','ArrowRight','Home','End','Enter'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    if(event.key==='Enter'&&editor.connecting){editor.attach(node.id);return;}
    const scene=flow.scenes.find(s=>s.id===node.id)!,current=editor.player.getSnapshot().flow;
    const frame=current?.sceneId===node.id?current.frame:0;
    editor.select(node.id,event.key==='Home'?0:event.key==='End'?sceneFrames(scene)-1:event.key==='Enter'?frame
      :frame+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?flow.fps:1));
  };
  const dragPlayhead=(event:React.PointerEvent<HTMLSpanElement>,node:StoryNode)=>{
    if(event.button!==0||panTool||space.current.held||groupTool)return;
    editor.player.pause();editor.select(node.id,null);event.currentTarget.focus({preventScroll:true});
    const current=editor.player.getSnapshot().flow,scene=flow.scenes.find(s=>s.id===node.id)!;
    const initial=current?.sceneId===node.id?current.frame:0;
    const origin=toWorld(localPoint({x:event.clientX,y:event.clientY}),cameraRef.current);
    trackGesture(event,point=>{
      // Preserve the grab offset so clicking either end of the time label never jumps.
      const delta=(toWorld(point,cameraRef.current).x-origin.x)/PIXELS_PER_SECOND*flow.fps;
      editor.player.seekFlowScene(node.id,Math.max(0,Math.min(sceneFrames(scene)-1,Math.round(initial+delta))));
    },()=>{},()=>editor.player.seekFlowScene(node.id,initial));
  };
  const scrub=(event:React.PointerEvent<HTMLDivElement>,node:StoryNode)=>{
    if(event.button!==0)return;event.stopPropagation();if(editor.connecting){editor.attach(node.id);return;}if(event.shiftKey){editor.select(node.id,0,true);return;}
    const target=event.currentTarget,rect=target.getBoundingClientRect(),scene=flow.scenes.find(s=>s.id===node.id)!;target.focus({preventScroll:true});
    if(cutTool){if(editor.split(node.id,frameAt(node,event.clientX,rect)))setCutTool(false);setCutPreview(null);return;}
    const seek=(x:number)=>editor.select(node.id,Math.max(0,Math.min(sceneFrames(scene)-1,frameAt(node,x,rect))));
    seek(event.clientX);target.setPointerCapture(event.pointerId);const move=(e:PointerEvent)=>seek(e.clientX);
    const end=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',end);};target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);
  };
  // Use the same target for the replacement preview and the committed drop.
  const libraryDropTarget=(target:EventTarget,item:LibraryItem|null)=>{
    if(!item||'assetId' in item)return {targetId:'canvas',connectionId:undefined,fromId:undefined};
    const element=target as Element,fromId=element.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
    const connectionId=element.closest('[data-edge-id]')?.getAttribute('data-edge-id')??(fromId?graph.edges.find(e=>e.from===fromId&&e.event==='next')?.id:undefined);
    return {targetId:connectionId??fromId??'canvas',connectionId,fromId};
  };
  const dragOver=(event:React.DragEvent<HTMLDivElement>)=>{
    if(!event.dataTransfer.types.includes(STORY_DRAG_TYPE)&&!event.dataTransfer.types.includes('Files'))return;
    event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';
    const files=event.dataTransfer.types.includes('Files');
    const pointer=localPoint({x:event.clientX,y:event.clientY});
    setFileDrag(files);setDropPoint(files?pointer:libraryOrigin(pointer));
    setDropTarget(libraryDropTarget(event.target,files?null:libraryDrag).targetId);
  };
  const drop=(event:React.DragEvent<HTMLDivElement>)=>{
    const payload=event.dataTransfer.getData(STORY_DRAG_TYPE),files=Array.from(event.dataTransfer.files);if(!payload&&(!files.length||files.some(file=>/\.sparko$/i.test(file.name))))return;event.preventDefault();event.stopPropagation();setFileDrag(false);setLibraryDrag(null);setDropTarget(null);setDropPoint(null);
    const pointer=localPoint({x:event.clientX,y:event.clientY}),point=toWorld(files.length?pointer:libraryOrigin(pointer),cameraRef.current);
    if(files.length){void editor.importVideos(files,point);return;}
    const item=readLibraryDrag(event.dataTransfer);if(!item)return;
    if('assetId' in item && item.assetId){editor.addAsset(item.assetId,point);return;}
    const {connectionId,fromId}=libraryDropTarget(event.target,item);
    if('mediaKind' in item)editor.addMedia(item.mediaKind,point,connectionId??undefined,fromId);
    else if('kind' in item&&['simple','looped','conditional'].includes(item.kind))editor.add(item.kind,connectionId??undefined,point,fromId);
    if('templateId' in item){const template=graph.templates.find(t=>t.id===item.templateId)??builtInTemplates.find(t=>t.id===item.templateId)?.id;if(template)editor.insertTemplate(template,connectionId??undefined,point,fromId);}
  };
  const contextAction=(action:()=>void)=>{action();setContext(null);scroll.current?.focus({preventScroll:true});};
  /** Over a clip, a comment pins to that moment of its media; elsewhere it stays at that point of the timeline. */
  const commentAnchorAt=(client:Point):CommentAnchor=>{
    const clip=document.elementsFromPoint(client.x,client.y).map(element=>element.closest<HTMLElement>('.story-clip[data-node-id]')).find(Boolean);
    const node=clip&&nodes.find(n=>n.id===clip.dataset.nodeId),scene=node&&flow.scenes.find(s=>s.id===node.id),strip=clip?.querySelector('.story-filmstrip');
    if(node&&scene&&strip){
      const bounds=strip.getBoundingClientRect(),layout=layouts[node.id],playhead=editor.player.getSnapshot().flow;
      let frame=Math.max(0,Math.min(sceneFrames(scene)-1,frameAt(node,client.x,bounds)));
      // Within a few pixels of the playhead, use its exact frame.
      if(playhead?.sceneId===node.id&&Math.abs(client.x-(bounds.left+(layout.before+playhead.frame/flow.fps)/layout.total*bounds.width))<=PLAYHEAD_SNAP)frame=playhead.frame;
      return clipAnchor(node,frame);
    }
    return toWorld(localPoint(client),cameraRef.current);
  };
  const atPlayhead=(anchor:CommentAnchor)=>{
    if(!isClipAnchor(anchor)||session?.sceneId!==anchor.nodeId)return false;
    const node=nodes.find(n=>n.id===anchor.nodeId);return !!node&&commentSceneFrame(node,anchor.frame)===session.frame;
  };
  const commentPlace=(anchor:CommentAnchor)=>{
    if(!isClipAnchor(anchor)){const p=toScreen(anchor,camera);return {...p,label:'the timeline',location:'Timeline',time:undefined,outside:false};}
    const node=nodes.find(n=>n.id===anchor.nodeId),scene=flow.scenes.find(s=>s.id===anchor.nodeId);if(!node||!scene)return;
    // Trimmed-out moments stay attached; their pin waits at the nearest edge.
    const frames=Math.max(1,Math.round(durations[node.id]*flow.fps)),frame=commentSceneFrame(node,anchor.frame),shown=Math.max(0,Math.min(frames-1,frame));
    const time=formatTime(playheadTime(scene,shown,flow.fps,playheadTimeMode),true);
    return {x:(node.x+shown/flow.fps*PIXELS_PER_SECOND)*zoom+camera.x,y:node.y*camera.rowScale+camera.y+CLIP_HEIGHT,outside:shown!==frame,
      label:`${scene.label} at ${time}`,location:`${time} · ${scene.label}`,time};
  };
  const seekComment=(anchor:CommentAnchor)=>{
    if(!isClipAnchor(anchor))return;
    const node=graph.nodes.find(n=>n.id===anchor.nodeId),scene=flow.scenes.find(s=>s.id===anchor.nodeId);if(!node||!scene)return;
    editor.player.pause();editor.player.seekFlowScene(node.id,Math.max(0,Math.min(sceneFrames(scene)-1,commentSceneFrame(node,anchor.frame))));
  };
  const openComment=(comment:StoryComment)=>{setCommentEditor({id:comment.id,anchor:comment.anchor});seekComment(comment.anchor);};
  const openCommentDraft=(anchor:CommentAnchor)=>{setCommentEditor({id:null,anchor});seekComment(anchor);};
  const commentPin=(id:string|null)=>scroll.current?.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(id??'new')}"]`)??null;
  // Keyboard users return to the pin they edited, or to the canvas, as soon as it renders.
  const commentFocus=useRef<string|null|undefined>(undefined);
  useLayoutEffect(()=>{
    const id=commentFocus.current,target=id===undefined?undefined:id?commentPin(id):scroll.current;
    if(target){commentFocus.current=undefined;target.focus({preventScroll:true});}
  });
  const dragComment=(event:React.PointerEvent<HTMLButtonElement>,id:string|null,anchor:CommentAnchor)=>{
    if(event.button!==0||panTool||space.current.held)return;
    const originalCamera=cameraRef.current,bounds=scroll.current!.getBoundingClientRect();let next=anchor;
    trackGesture(event,point=>{next=commentAnchorAt({x:point.x+bounds.left,y:point.y+bounds.top});setCommentDrag({id,anchor:next});},
      moved=>{setCommentDrag(null);
        if(!moved){const comment=comments.find(c=>c.id===id);if(comment)openComment(comment);return;}
        if(id)editor.updateComment(id,{anchor:next});else setCommentEditor(current=>current&&{...current,anchor:next});
        editor.setNotice(isClipAnchor(next)?'Comment pinned to this moment of the clip.':'Comment placed on the timeline.');},
      ()=>{setCommentDrag(null);updateCamera(originalCamera);},true);
  };
  const nudgeComment=(event:React.KeyboardEvent<HTMLButtonElement>,id:string|null,anchor:CommentAnchor)=>{
    if(!id||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const dx=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0,dy=event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0;
    if(!isClipAnchor(anchor)){const step=event.shiftKey?10:1;editor.updateComment(id,{anchor:{x:anchor.x+dx*step,y:anchor.y+dy*step}});return;}
    const node=graph.nodes.find(n=>n.id===anchor.nodeId),scene=flow.scenes.find(s=>s.id===anchor.nodeId);if(!dx||!node||!scene)return;
    const next=clipAnchor(node,Math.max(0,Math.min(sceneFrames(scene)-1,commentSceneFrame(node,anchor.frame)+dx*(event.shiftKey?flow.fps:1))));
    editor.updateComment(id,{anchor:next});seekComment(next);
  };
  const selectOrphaned=()=>{
    editor.setSelected(orphaned.map(node=>node.id));editor.setSelectedEdge(null);
    editor.jobs.select(orphaned.length===1?orphaned[0].interstitialId??null:null);
    editor.setNotice(`${orphaned.length} orphaned ${orphaned.length===1?'clip':'clips'} selected · Disconnected from story start.`);
  };
  const joinSelected=()=>{chooseTool(null);setContext(null);setJoinError(editor.join());};
  const toggleCollapsed=()=>{
    if(workspaceLocked)return;
    if(!collapsed){chooseTool(null);setContext(null);setTemplateName(null);setCommentEditor(null);setWire(null);setCutPreview(null);editor.setConnecting(null);hovering.current=false;space.current={held:false,used:false};setSpaceHeld(false);}
    onCollapsed(!collapsed);
  };
  const contextGroup=graph.groups?.find(g=>g.id===context?.groupId),contextMemberGroup=graph.groups?.find(g=>g.nodeIds.includes(context?.id??''));
  const contextConnectionId=context?.edgeId??graph.edges.find(e=>e.from===context?.id&&e.event==='next')?.id;
  const contextScene=flow.scenes.find(s=>s.id===context?.id);
  const contextNode=graph.nodes.find(node=>node.id===context?.id);
  const canCutAtPlayhead=!!contextScene&&session?.sceneId===contextScene.id&&session.frame>0&&session.frame<sceneFrames(contextScene);
  const membersToAdd=(context?.selectionIds??[]).filter(id=>!contextGroup?.nodeIds.includes(id));
  return <div ref={root} className={`story-canvas ${collapsed?'collapsed':''} ${wire||editor.connecting?'connecting':''} ${cutTool?'cut-tool':''} ${groupTool?'draw-group-tool':''} ${commentTool?'comment-tool':''} ${panTool||spaceHeld?'pan-tool':''} ${panning?'panning':''} ${dropTarget?'library-drag':''} ${libraryDrag?'dragging-library':''} ${insertingLibrary||movingInterstitial?'dragging-insert':''}`} style={{height:collapsed?'auto':height}}>
    {!collapsed&&<ResizeHandle orientation="horizontal" label="Resize story canvas" value={height} min={220} max={maxHeight} onChange={onHeight}/>}
    <div className="story-toolbar"><button className="story-collapse" disabled={workspaceLocked} aria-label={collapsed?'Expand timeline':'Collapse timeline'} aria-expanded={!collapsed} aria-controls={canvasId} title={workspaceLocked?'Unlock workspace in Window to collapse the timeline':collapsed?'Expand timeline':'Collapse timeline'} onClick={toggleCollapsed} onKeyDown={e=>{if(e.key===' ')e.stopPropagation();}}><ChevronDown size={14}/><span className="eyebrow">TIMELINE</span></button><span className="story-collapsed-summary">{nodes.length} {nodes.length===1?'clip':'clips'}</span>
      <button className="button small" title={shortcuts.title('layout')} aria-keyshortcuts={shortcuts.aria('layout')} onClick={cleanup}>Auto layout</button>
      <AudioLayers projects={editor.projects} player={editor.player} duration={flowLayout(flow).totalFrames / flow.fps}/>
      <div className="story-toolbar-spacer"/><button className="icon-button small" title={shortcuts.title('duplicate')} aria-label="Duplicate selected clips" disabled={!editor.selected.length&&!editor.selectedGroup} onClick={editor.duplicate}><Copy size={14}/></button>
      <button className="icon-button small story-join" title={editor.joinReasons.length?'Join unavailable · Click to see all reasons':'Join selected clips · Same source, connected in graph order'} aria-label="Join selected clips" aria-disabled={!!editor.joinReasons.length} aria-describedby={`${canvasId}-join-help`} onClick={joinSelected}><Combine size={14}/></button>
      <span id={`${canvasId}-join-help`} className="sr-only">When Join is unavailable, activate it to see all reasons.</span>
      <button className={`icon-button small ${cutTool?'active':''}`} title={shortcuts.title('cut')+'. Click a clip to split it.'} aria-label="Cut tool" aria-pressed={cutTool} onClick={()=>chooseTool('cut')}><Scissors size={14}/></button>
      <button className={`icon-button small ${groupTool?'active':''}`} title="Draw group · Drag a frame around clips or draw an empty group. Escape cancels." aria-label="Draw group tool" aria-pressed={groupTool} onClick={()=>chooseTool('group')}><SquareDashed size={14}/></button>
      <button className={`icon-button small ${commentTool?'active':''}`} aria-label="Comment tool" aria-pressed={commentTool} title={shortcuts.title('comment')+'. Click a clip to comment on that moment, or anywhere on the timeline.'} onClick={()=>chooseTool('comment')}><MessageSquarePlus size={14}/></button>
      <button className={`icon-button small ${panTool?'active':''}`} aria-label="Pan tool" aria-pressed={panTool} title={shortcuts.title('pan')+'. Also pan with Space + drag or the middle mouse button.'} onClick={()=>chooseTool('pan')}><Hand size={14}/></button>
      <button className="icon-button small" aria-label="Zoom out story" onClick={()=>updateCamera(zoomAt(cameraRef.current,zoom/1.4,{x:size.width/2,y:size.height/2}))}><Minus size={14}/></button>
      <span className="story-zoom">{Math.round(zoom*100)}%</span>
      <button className="icon-button small" aria-label="Zoom in story" onClick={()=>updateCamera(zoomAt(cameraRef.current,zoom*1.4,{x:size.width/2,y:size.height/2}))}><Plus size={14}/></button>
      <button className="button small" aria-label="Fit" aria-keyshortcuts={shortcuts.aria('fit')} title={shortcuts.title('fit','Fit selected clips, or all clips with no selection')} onClick={fitSelected}>Fit</button>
      <button className={`icon-button small ${follow?'active':''}`} aria-label="Follow playhead" aria-pressed={follow} onClick={()=>setFollow(v=>!v)}><Maximize size={14}/></button>
    </div>
    <div id={canvasId} className="story-scroll" hidden={collapsed} ref={scroll} tabIndex={0} aria-label="Clip graph" data-zoom={zoom} onPointerEnter={()=>{hovering.current=true;}} onPointerLeave={()=>{hovering.current=false;setCommentGhost(null);}}
      onPointerMove={e=>{lastPointer.current={x:e.clientX,y:e.clientY};if(!commentTool)return;
        const next=e.buttons||(e.target as Element).closest('[data-comment-id]')?null:commentAnchorAt({x:e.clientX,y:e.clientY});setCommentGhost(current=>sameAnchor(current,next)?current:next);}} style={{backgroundPosition:`${camera.x}px ${camera.y}px`,backgroundSize:`${gridX*4}px ${gridY*4}px, ${gridX}px ${gridY}px`}} onPointerDownCapture={beginAreaGesture} onFocusCapture={e=>{const id=(e.target as Element).closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;if(id)reveal(id);}} onDrop={drop} onDragOver={dragOver} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)){setFileDrag(false);setDropTarget(null);setDropPoint(null);}}} onContextMenu={e=>{
      e.preventDefault();chooseTool(null);
      const pin=(e.target as Element).closest<HTMLElement>('[data-comment-id]'),pinned=comments.find(c=>c.id===pin?.dataset.commentId);
      if(pin){setContext(null);if(pinned)openComment(pinned);return;}
      const clip=(e.target as Element).closest<HTMLElement>('[data-node-id]'),id=clip?.dataset.nodeId;
      const edgeId=(e.target as Element).closest('[data-edge-id]')?.getAttribute('data-edge-id')??undefined,pointId=(e.target as Element).closest('[data-reroute-id]')?.getAttribute('data-reroute-id')??undefined;
      if(edgeId){editor.setSelectedEdge(edgeId);editor.setSelected([]);}if(id&&(editor.selectedGroup||!editor.selected.includes(id)))editor.select(id,null);
      const point=localPoint({x:e.clientX,y:e.clientY}),groupId=!id&&!edgeId?((e.target as Element).closest<HTMLElement>('[data-group-id]')?.dataset.groupId??groupViews.find(g=>point.x>=g.left&&point.x<=g.left+g.width&&point.y>=g.top&&point.y<=g.top+g.height)?.group.id):undefined;
      if(groupId)editor.selectGroup(groupId);setContext({id,groupId,edgeId,pointId,selectionIds:editor.selected,commentAnchor:Number.isFinite(e.clientX)&&Number.isFinite(e.clientY)?commentAnchorAt({x:e.clientX,y:e.clientY}):undefined,x:e.clientX,y:e.clientY,point:toWorld(localPoint({x:e.clientX,y:e.clientY}),cameraRef.current)});
    }}>
      {!nodes.length&&!graph.groups?.length&&!fileDrag&&!groupTool&&<div className="story-empty"><Upload size={22}/><strong>Drop videos or images here</strong><span>Each file becomes a separate clip.</span><button className="button small" onClick={()=>videoInput.current?.click()}>Import videos or images</button></div>}
      {fileDrag&&dropPoint&&<div className="story-file-drop" style={{left:dropPoint.x,top:dropPoint.y}}><Upload size={14}/><span>Import clips here</span></div>}
      <div className="story-world">
        {groupViews.map(({group,left,top,width,height})=><div key={group.id} data-group-id={group.id} className={`story-group ${editor.selectedGroup?.id===group.id?'selected':''}`}
          data-compact={width<180} data-tiny={width<60} style={{left,top,width,height,'--group-color':groupColors[group.color]} as React.CSSProperties}>
          <button className="story-group-header" aria-label={`Select group ${group.name}`} title="Drag to move the group. Double-click to rename. Right-click for group actions."
            onPointerDown={e=>{if(e.button!==0||panTool||space.current.held)return;editor.selectGroup(group.id);scroll.current?.focus({preventScroll:true});dragClips(e,group.nodeIds,group.id);}}
            onClick={e=>{if(e.detail===0)editor.selectGroup(group.id);}} onDoubleClick={()=>focusGroupName(group.id)}
            onKeyDown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();const step=e.shiftKey?32:8;editor.change(moveGroup(graph,group.id,e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0));}}}>
            <GripVertical size={13}/><span>{group.name}</span><small>{group.nodeIds.length} {group.nodeIds.length===1?'clip':'clips'}</small>
          </button>
          {editor.selectedGroup?.id===group.id&&<button className="story-group-resize" aria-label={`Resize group ${group.name}`} title="Drag to resize group. Arrow keys resize; Shift for larger steps." onPointerDown={e=>resizeGroup(e,group.id)}
            onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const step=e.shiftKey?32:8,p=toWorld({x:left,y:top},camera);
              editor.patchGroup(group.id,{bounds:{...p,width:Math.max(96,width+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0))/zoom,height:Math.max(64,height+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0))/camera.rowScale}});}}/>}
        </div>)}
        {previewFrame&&previewGroup&&<div className="story-group-preview" aria-hidden style={{...previewFrame,'--group-color':groupColors[previewGroup.color]} as React.CSSProperties}><div className="story-group-header"><GripVertical size={13}/><span>{previewGroup.name}</span><small>{previewGroup.nodeIds.length} clips</small></div></div>}
        {drawnGroup&&<div className="story-group-drawing" aria-hidden style={{left:drawnGroup.x*zoom+camera.x,top:drawnGroup.y*camera.rowScale+camera.y,width:drawnGroup.width*zoom,height:drawnGroup.height*camera.rowScale}}><span>New group</span></div>}
        {dropPoint&&dragPreview.map(n=><div key={n.id} className={`story-drop-preview type-${n.kind}`} aria-hidden style={{left:dropPoint.x+n.x*zoom,top:dropPoint.y+n.y*camera.rowScale,width:n.duration*PIXELS_PER_SECOND*zoom,height:CLIP_HEIGHT,'--clip-color':clipColors[n.color??'gray']} as React.CSSProperties}><div className="story-clip-title"><span>{n.name}</span><small>{n.duration.toFixed(1)}s</small></div><div className="story-drop-filmstrip"/></div>)}
        <svg className="story-edges" width={size.width} height={size.height} aria-label="Clip connections"><defs><linearGradient id="story-fade-ramp"><stop offset="0" stopColor="currentColor" stopOpacity=".15"/><stop offset="1" stopColor="currentColor"/></linearGradient><marker id="story-arrow" markerWidth={Math.max(3,Math.min(7,zoom*10))} markerHeight={Math.max(3,Math.min(7,zoom*10))} viewBox="0 0 7 7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7Z" fill="currentColor"/></marker><marker id="story-arrow-mismatch" markerWidth={Math.max(3,Math.min(7,zoom*10))} markerHeight={Math.max(3,Math.min(7,zoom*10))} viewBox="0 0 7 7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7Z" fill="#f17c76"/></marker></defs>
        {wire&&position(wire.anchor)&&(()=>{const node=position(wire.anchor),anchor=wire.reverse?inputPoint(node):outputPoint(node,wire.edgeId,wire.conditionId);return <path className="story-edge-line story-wire" d={wire.reverse?linkGeometry(wire,anchor).path:linkGeometry(anchor,wire).path}/>;})()}
          {graph.edges.map(connection=>{const from=position(connection.from),to=position(connection.to);if(!from||!to)return null;
            const self=from.id===to.id,{path:d,middle:{x:mx,y:my},points}=geometry(connection),reference=references[connection.id];
            return <g key={connection.id} data-edge-id={connection.id} data-reference-state={reference.state} style={{color:connectionColors[connection.id]}} onPointerEnter={()=>setHoveredConnection(connection.id)} onPointerLeave={()=>setHoveredConnection(null)} className={`story-edge ${reference.state==='mismatch'?'reference-mismatch':''} ${wire?.edgeId===connection.id?'rewiring':''} ${editor.selectedEdge===connection.id?'selected':''} ${dropConnection?.id===connection.id?'drop-target':''} ${session?.traversedEdgeIds.includes(connection.id)?'traversed':''}`}>
              {dropConnection?.id===connection.id&&<path className="story-edge-drop-highlight" d={d} aria-hidden/>}
              <path className="story-edge-line" d={d} markerEnd={reference.state==='mismatch'?"url(#story-arrow-mismatch)":"url(#story-arrow)"}/><path className="story-edge-hit" d={d} tabIndex={0} role="button" aria-label={`Connection ${from.name} to ${to.name}: ${connection.label}`} aria-description={reference.message} onPointerDown={e=>beginConnection(e,from,e.shiftKey?undefined:connection.id,false,true)} onClick={()=>{if(!suppressClick.current)editor.selectConnection(connection.id);}} onDoubleClick={e=>{e.preventDefault();addReroute(connection.id,toWorld(localPoint({x:e.clientX,y:e.clientY}),cameraRef.current));}} onKeyDown={e=>{if(e.key==='Enter'){editor.selectConnection(connection.id);}}}><title>{reference.message} Drag to reconnect. Double-click to add a reroute point.</title></path>
              {zoom>=.75&&connection.event!=='next'&&!behaviors(from).conditional&&<text x={mx} y={my-17} textAnchor="middle">{connection.label}</text>}
              {!self&&fadeButtons.has(connection.id)&&<g className="story-crossfade" role="button" aria-label={`Edit crossfade from ${from.name} to ${to.name}`} tabIndex={0} onClick={()=>editor.selectConnection(connection.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();editor.selectConnection(connection.id);}}}>
                <title>Edit crossfade in Inspector</title><rect className="story-crossfade-drop-hit" x={mx-25} y={my-23} width={50} height={46} rx={9}/><rect x={mx-13} y={my-11} width={26} height={22} rx={5}/>
                <svg x={mx-8} y={my-6} width={16} height={12} viewBox="0 0 16 12" aria-hidden><path className="fade-ramp" d="M1 1V11H15Z"/><path className="fade-ramp" d="M15 1V11H1Z"/></svg>
              </g>}
              {(zoom>=.75||editor.selectedEdge===connection.id?points:[]).map((point,index)=>{const p=toScreen(point,camera);return <circle key={point.id} data-reroute-id={point.id} className="story-reroute" cx={p.x} cy={p.y} r={5} tabIndex={0} role="button" aria-label={`Reroute point ${index+1} from ${from.name} to ${to.name}`}
                onPointerDown={e=>dragReroute(e,connection,point)} onDoubleClick={e=>{e.stopPropagation();removeReroute(connection.id,point.id);}}
                onKeyDown={e=>{if(shortcuts.action(e.nativeEvent)==='delete'){e.preventDefault();e.stopPropagation();removeReroute(connection.id,point.id);}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();const step=e.shiftKey?10:1;editor.change({...graph,edges:graph.edges.map(c=>c.id===connection.id?{...c,points:c.points?.map(v=>v.id===point.id?{...v,x:v.x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),y:v.y+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0)}:v)}:c)});}}}><title>{shortcuts.title('delete','Delete point')+'. Drag to shape the wire; double-click to remove.'}</title></circle>;})}
            </g>;})}
        </svg>
        {nodes.map(node=>{const originalScene=flow.scenes.find(s=>s.id===node.id)!;
          const scene=trimPreview?.node.id===node.id?trimPreviewScene(originalScene,node,editor.items):originalScene;
          const item=editor.items.find(i=>i.id===node.interstitialId),active=session?.sceneId===node.id,selected=editor.selected.includes(node.id);
          const {assetId,start}=sceneMediaRange(scene,flow.fps),url=assets.url(assetId),range=clipTrimRange(node,editor.items,trimSourceDuration(node));
          const generation=editor.projects.getSnapshot().project?.clipGenerations?.find(g=>g.id===node.generationId);
          const mediaError=!scene.draft&&assets.error(assetId);
          const issues:ContentIssue[]=[...(item?editor.jobs.dependency(item.id)?.issues??[]:[])];
          for (const ref of generation?.settings.references ?? []) if (assets.error(ref.assetId)) issues.push({ key: `reference:${ref.assetId}`, title: `Missing reference: ${ref.name}`, message: assets.error(ref.assetId)! });
          if(mediaError)issues.push({key:'output',title:item?'Video output unavailable':'Source video unavailable',message:mediaError});
          if(generation?.error)issues.push({key:'clip-generation',title:'Generation failed',message:generation.error});
          if(item?.phase==='error')issues.push({key:'generation',title:'Generation failed',message:item.error||'No video output was saved. Retry generation in the Inspector.'});
          const offset=trimPreview?.node.id===node.id?trimFrameOffset(originalScene.storyNode!,node):0;
          const displayFrame=!active?0:trimPreview?.node.id===node.id?Math.max(0,Math.min(sceneFrames(scene)-1,session.frame-offset)):session.frame;
          const layout=layouts[node.id],clipWidth=layout.total*PIXELS_PER_SECOND*zoom,progress=active?(layout.before+displayFrame/flow.fps)/layout.total:0;
          const labelWidth=conditionLabelWidth(node),detail=clipWidth>=150?'full':clipWidth>=66?'label':clipWidth>=20?'icon':'minimal';
          const imageClip=(node.source?.kind??node.mediaKind)==='image';
          return <div key={node.id} className={`story-clip type-${node.kind} ${selected?'selected':''} ${active?'playing':''} ${scene.draft?'draft':''} ${trimPreview?.node.id===node.id?'trimming':''} ${reached.has(node.id)?'':'disconnected'} ${dropTarget===node.id?'drop-target':''}`} data-node-id={node.id} data-start={graph.entryId===node.id} data-kind={node.kind} data-duration={durations[node.id]} data-media-duration={layout.total} data-detail={detail} data-ports-visible={zoom>=.75&&clipWidth>=32} data-condition-labels={labelWidth>0} data-color={node.color??'gray'} style={{left:clipLeft(node)*zoom+camera.x,top:node.y*camera.rowScale+camera.y,width:clipWidth,height:CLIP_HEIGHT,'--clip-color':clipColors[node.color??'gray'],'--port-size':'14px','--condition-label-width':`${labelWidth}px`} as React.CSSProperties}>
            {graph.entryId===node.id&&<span className="story-start-marker" role="img" aria-label="Start video" title="This video starts the experience"><Flag size={12} aria-hidden/></span>}
            <button className="story-clip-title" aria-label={`Select ${scene.label}`} title={`${scene.label} · ${durations[node.id].toFixed(2)} seconds · Drag title to move`} onPointerDown={e=>dragTitle(e,node)} onClick={e=>{if(e.detail===0){if(editor.connecting)editor.attach(node.id);else editor.select(node.id);}}}><ClipTypeIcon node={node}/><span className="story-clip-name">{scene.label}</span><small>{durations[node.id].toFixed(1)}s</small></button>
            <ContentIssues className="story-clip-issues" issues={issues} label={`${scene.label} errors`} />
            <div className="story-filmstrip" role="slider" tabIndex={0} aria-label={`Scrub ${scene.label}`} aria-valuemin={0} aria-valuemax={sceneFrames(scene)/flow.fps} aria-valuenow={active?session.frame/flow.fps:0} onPointerDown={e=>scrub(e,node)} onKeyDown={e=>scrubKey(e,node)}>
              {scene.draft||mediaError?<div className="story-unavailable-thumbnail" role="img" aria-label={mediaError?'Video unavailable: missing media':'Video unavailable: not generated yet'} title={mediaError||'Not generated yet. Generate this clip in the Inspector.'}><ImageOff size={18} strokeWidth={1.5} aria-hidden/>{clipWidth>=90&&<span aria-hidden>{mediaError?'Media unavailable':generation&&generationBusy(generation)?'Generating…':'Not generated'}</span>}</div>:url?<VideoFilmstrip kind={node.source?.kind} assetId={assetId} url={url} start={start-layout.before} end={start+layout.body+layout.after}/>:<ClipLoading message="Loading clip"/>}
              {scene.generated&&selectedGenerations.some(generation=>generation.id===item?.id)&&<>
                {layout.before>0&&<span className="story-reference-section opening" role="img" aria-label={`Opening reference: ${layout.before.toFixed(3)} seconds`} style={{left:0,width:`${layout.before/layout.total*100}%`}} title="Opening reference · Used to match the previous clip">{layout.before*PIXELS_PER_SECOND*zoom>32&&<b aria-hidden>Start</b>}</span>}
                <span className="story-generated-section" role="img" aria-label={`Generated section: ${layout.body.toFixed(3)} seconds`} style={{left:`${layout.before/layout.total*100}%`,width:`${layout.body/layout.total*100}%`}} title="Generated section · Played in the story"/>
                {layout.after>0&&<span className="story-reference-section ending" role="img" aria-label={`Ending reference: ${layout.after.toFixed(3)} seconds`} style={{right:0,width:`${layout.after/layout.total*100}%`}} title="Ending reference · Used to match the next clip">{layout.after*PIXELS_PER_SECOND*zoom>32&&<b aria-hidden>End</b>}</span>}
              </>}
              {(['video','audio'] as const).flatMap(channel=>{
                const laneEnds:number[]=[];
                const channelRegions=(regions[node.id]??[]).filter(region=>region.channel===channel&&region.edgeId===editor.selectedEdge).sort((a,b)=>a.start-b.start).map(region=>{
                  const free=laneEnds.findIndex(end=>end<=region.start),lane=free<0?laneEnds.length:free;
                  laneEnds[lane]=region.end;return {...region,lane};
                });
                return channelRegions.map(region=>{
                  const label=`${channel==='video'?'Video':'Audio'} crossfade ${region.direction==='in'?'from':'to'} ${region.neighbor}: ${region.duration.toFixed(3)} seconds`;
                  return <span key={`${region.edgeId}:${channel}:${region.direction}`} role="img" aria-label={label}
                    className={`story-transition-region ${region.direction} ${editor.selectedEdge===region.edgeId?'selected':''}`} data-edge-id={region.edgeId} data-channel={channel}
                    data-media-start={region.mediaStart} data-media-end={region.mediaEnd}
                    title={`${label} · ${region.mediaStart.toFixed(3)}–${region.mediaEnd.toFixed(3)} s in this video`}
                    onPointerEnter={()=>setHoveredConnection(region.edgeId)} onPointerLeave={()=>setHoveredConnection(null)}
                    style={{left:`${region.start/layout.total*100}%`,width:`${(region.end-region.start)/layout.total*100}%`,
                      top:`${(channel==='video'?0:50)+region.lane*50/laneEnds.length}%`,height:`${50/laneEnds.length}%`,color:connectionColors[region.edgeId],
                      '--fade-shape':fadeRegionShape(region)} as React.CSSProperties}>
                    {(region.end-region.start)*PIXELS_PER_SECOND*zoom>=20&&laneEnds.length<=2&&<b aria-hidden>{channel==='video'?'V':'A'}</b>}
                  </span>;
                });
              })}
              {(highlights[node.id]??[]).map((highlight,index)=>{
                const label=`${highlight.side==='start'?'Start':'End'} reference for ${highlight.label}: ${highlight.mediaStart.toFixed(3)}–${highlight.mediaEnd.toFixed(3)} seconds${highlight.held?' · held final frame':''}`;
                return <span key={`${highlight.generationId}:${highlight.side}:${index}`} className={`story-reference-highlight ${highlight.side}`} role="img" aria-label={label}
                  data-generation-id={highlight.generationId} data-side={highlight.side} data-media-start={highlight.mediaStart} data-media-end={highlight.mediaEnd}
                  style={{left:`${highlight.start/layout.total*100}%`,width:`${(highlight.end-highlight.start)/layout.total*100}%`}}>
                  {(highlight.end-highlight.start)*PIXELS_PER_SECOND*zoom>50&&<b aria-hidden>{highlight.side==='start'?'Start ref':'End ref'}</b>}
                </span>;
              })}
              {generation&&generationBusy(generation)&&<ClipJobStatus label={scene.label} message={generation.phase==='queued'?'Queued':'Generating…'}/>}
              {item&&isGenerating(item)&&<ClipJobStatus label={scene.label} message={phaseLabel(item)}/>}
              {item?.phase==='error'&&<span className="story-clip-error" title={item.error}>Failed · Retry in inspector</span>}
              {cutTool&&<span className="story-cut-surface" onPointerMove={e=>{const bounds=e.currentTarget.getBoundingClientRect();setCutPreview({id:node.id,frame:Math.max(0,Math.min(sceneFrames(scene),frameAt(node,e.clientX,bounds)))});}} onPointerLeave={()=>setCutPreview(null)}/>}
              {cutTool&&cutPreview?.id===node.id&&<span className="story-cut-preview" style={{left:`${(layout.before+cutPreview.frame/flow.fps)/layout.total*100}%`}}/>}
            </div>
            {selected&&!panTool&&!spaceHeld&&!cutTool&&!groupTool&&(['start','end'] as const).map(side=><button key={side} type="button" role="slider" className={`story-trim-handle ${side} ${scene.generated&&(side==='start'?layout.before:layout.after)>0?'reference':''}`}
              data-active={trimPreview?.node.id===node.id&&trimPreview.side===side||undefined}
              style={{left:`${(layout.before+(side==='end'?layout.body:0))/layout.total*100}%`}} aria-label={`Trim ${side} of ${scene.label}`}
              aria-orientation="horizontal" aria-valuemin={imageClip?1/flow.fps:side==='start'?0:(range.inFrame+1)/flow.fps} aria-valuemax={imageClip?undefined:Number.isFinite(range.totalFrames) || side==='start' ? (side==='start'?range.outFrame-1:range.totalFrames)/flow.fps : undefined}
              aria-valuenow={(imageClip?range.outFrame-range.inFrame:side==='start'?range.inFrame:range.outFrame)/flow.fps} aria-valuetext={imageClip?`${((range.outFrame-range.inFrame)/flow.fps).toFixed(3)} seconds duration`:`${((side==='start'?range.inFrame:range.outFrame)/flow.fps).toFixed(3)} seconds`}
              title={imageClip?`Drag either edge to extend or shorten the image. Arrow keys move this edge one frame; Shift moves ten. ${side==='start'?'End':'Home'} reduces the duration to one frame.`:`Drag to trim ${side}. Arrow keys adjust one frame; Shift adjusts ten. Home/End reach the available limits.`}
              onPointerDown={event=>dragTrim(event,node,side)} onKeyDown={event=>trimKey(event,node,side)}/>) }
            <button className="story-port input" aria-label={`Connect to ${scene.label}`} title="Drag to reconnect an incoming wire. Shift-drag to connect from another output." onPointerDown={e=>beginInput(e,node)} onClick={()=>{if(!suppressClick.current)editor.attach(node.id);}}/>
            {outputPorts(graph,node).map((port,index,ports)=><button key={port.id} className={`story-port output ${behaviors(node).conditional?'conditional-output':''}`} data-condition-id={port.conditionId} data-output-id={port.id} data-default={port.isDefault}
              style={behaviors(node).conditional?{top:outputOffset(ports.length,index)}:undefined}
              aria-label={behaviors(node).conditional?`Connect ${port.label} from ${scene.label}`:`Connect from ${scene.label}`}
              title={`${port.isDefault?'Default condition. ':''}Drag ${port.label} to a clip${port.edgeId?' to reconnect':''}`}
              onPointerDown={e=>beginConnection(e,node,port.edgeId,false,true,port)}
              onClick={()=>{if(!suppressClick.current&&port.edgeId)editor.selectConnection(port.edgeId);}}>
              {behaviors(node).conditional&&<><span>{port.label||'Unnamed condition'}</span><i aria-hidden/></>}
            </button>)}
            {active&&<div className="story-playhead" style={{left:`${Math.min(100,progress*100)}%`}}><span role="slider" tabIndex={0} aria-label={`Playhead of ${scene.label}`} aria-orientation="horizontal"
              aria-valuemin={playheadTime(scene,Math.min(0,displayFrame),flow.fps,playheadTimeMode)} aria-valuemax={playheadTime(scene,Math.max(sceneFrames(scene)-1,displayFrame),flow.fps,playheadTimeMode)}
              aria-valuenow={playheadTime(scene,displayFrame,flow.fps,playheadTimeMode)} aria-valuetext={formatTime(playheadTime(scene,displayFrame,flow.fps,playheadTimeMode),true)}
              title={`${playheadTimeMode==='internal'?'Clip internal time':'Elapsed from clip start'} · Drag to scrub. Arrow keys adjust one frame; Shift adjusts one second. Escape cancels a drag.`}
              onPointerDown={event=>dragPlayhead(event,node)} onKeyDown={event=>scrubKey(event,node)}>{formatTime(playheadTime(scene,displayFrame,flow.fps,playheadTimeMode),true)}</span><i/></div>}
            {!reached.has(node.id)&&clipWidth>=20&&<span className="story-clip-caption" role="img" aria-label="Disconnected from story start" title="Disconnected from story start"><Unplug size={12} aria-hidden/></span>}
          </div>;
        })}
        {(()=>{
          const views=[...comments.map(comment=>({id:comment.id as string|null,comment:comment as StoryComment|undefined,anchor:comment.anchor,color:comment.color})),
            ...(commentEditor&&!commentEditor.id?[{id:null,comment:undefined,anchor:commentEditor.anchor,color:commentEditor.color}]:[])].flatMap(view=>{
            const dragging=!!commentDrag&&commentDrag.id===view.id,shown=dragging?commentDrag!.anchor:view.anchor,place=commentPlace(shown);
            return place?[{...view,dragging,shown,place}]:[];
          });
          // Labels run right from each pin and shorten before the next pin on the same row.
          // Only far out do they collapse to icons; hovering shows more of the text.
          const labelWidth=(view:typeof views[number])=>!view.comment||zoom<PIN_LABEL_ZOOM?0:Math.max(PIN_LABEL_MIN,Math.min(PIN_LABEL_MAX,
            ...views.filter(other=>other!==view&&!other.dragging&&Math.abs(other.place.y-view.place.y)<20&&other.place.x>=view.place.x).map(other=>other.place.x-view.place.x-4)));
          const ghost=commentTool&&commentGhost?commentPlace(commentGhost):undefined;
          return <>
            {views.map(view=>{
              const {id,comment,anchor,shown,dragging,place,color}=view,open=!!commentEditor&&commentEditor.id===id,summary=comment?commentSummary(comment):'New comment',width=labelWidth(view);
              return <button key={id??'new'} type="button" data-comment-id={id??'new'} data-color={color??'default'} data-labelled={width>0}
                className={`story-comment-pin ${isClipAnchor(shown)?'on-clip':'on-canvas'} ${comment?.resolved?'resolved':''} ${open?'open':''} ${place.outside?'outside':''} ${dragging?'dragging':''} ${dragging&&atPlayhead(shown)?'snapped':''} ${id?'':'draft'}`}
                style={{left:place.x,top:place.y,'--pin-width':`${width||20}px`,...color?{'--comment-color':clipColors[color]}:{}} as React.CSSProperties} aria-expanded={open} aria-haspopup="dialog"
                aria-label={comment?`${comment.resolved?'Resolved comment':'Comment'} on ${place.label}: ${summary}`:`New comment on ${place.label}`}
                title={`${summary}\n${place.label}${place.outside?' · trimmed out of the clip':''}\nClick to open · Drag to move · ${shortcuts.label('delete')} removes`}
                onPointerDown={e=>dragComment(e,id,anchor)} onClick={e=>{if(e.detail===0&&comment)openComment(comment);}} onKeyDown={e=>nudgeComment(e,id,anchor)}>
                <span className="story-comment-bubble"><span className="story-comment-icon">{comment?.resolved?<Check size={11} aria-hidden/>:<MessageSquare size={11} aria-hidden/>}</span>
                  {comment&&<span className="story-comment-label" aria-hidden>{commentSummary(comment,60)}</span>}</span>
              </button>;
            })}
            {ghost&&commentGhost&&<span className={`story-comment-pin ghost ${isClipAnchor(commentGhost)?'on-clip':'on-canvas'} ${atPlayhead(commentGhost)?'snapped':''}`} aria-hidden
              style={{left:ghost.x,top:ghost.y,'--pin-width':ghost.time?`${PIN_LABEL_MAX}px`:'20px'} as React.CSSProperties}>
              <span className="story-comment-bubble"><span className="story-comment-icon"><MessageSquarePlus size={11}/></span>{ghost.time&&<span className="story-comment-label">{ghost.time}</span>}</span>
            </span>}
          </>;
        })()}
        {dropConnection&&(()=>{const {middle}=geometry(dropConnection);return <div className="story-transition-drop-label" aria-hidden
          style={{left:Math.max(8,Math.min(middle.x-75,size.width-158)),top:Math.max(8,middle.y-49)}}><Plus size={13}/>Replace transition</div>;})()}
        {marquee&&<div className="story-marquee" style={{left:Math.min(marquee.start.x,marquee.end.x)*zoom+camera.x,top:Math.min(marquee.start.y,marquee.end.y)*camera.rowScale+camera.y,width:Math.abs(marquee.end.x-marquee.start.x)*zoom,height:Math.abs(marquee.end.y-marquee.start.y)*camera.rowScale}}/>}
      </div>
    </div>
    <input ref={videoInput} hidden multiple type="file" accept="video/*,image/*,.mkv,.mov,.webm,.mp4" aria-label="Import videos onto timeline" onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';void editor.importVideos(files);}}/>
    <div className="story-status"><span role="status">{trimPreview?`Trim ${trimPreview.side} · ${nodeDuration(trimPreview.node,editor.items).toFixed(3)} s · Release to apply · Escape cancels`:dropTarget?(fileDrag?'Release to import clips here':libraryDrag&&'assetId' in libraryDrag?'Release to add a separate clip':dropTarget==='canvas'?'Release to place here':dropConnection?'Release to replace transition and connect both sides':'Release to attach to this clip'):libraryDrag?'Drag onto the timeline · Escape cancels':wire?'Drop onto a clip to connect · Escape cancels':editor.connecting?'Choose a destination clip · Escape cancels':commentDrag?`${isClipAnchor(commentDrag.anchor)?`Release to pin the comment at ${commentPlace(commentDrag.anchor)?.time??'this moment'}`:'Release to place the comment here'}${atPlayhead(commentDrag.anchor)?' · Snapped to playhead':''} · Escape cancels`
      :commentTool?commentGhost&&isClipAnchor(commentGhost)?`Click to comment on ${commentPlace(commentGhost)?.label??'this clip'}${atPlayhead(commentGhost)?' · Snapped to playhead':''} · ${shortcuts.title('select')}`:`Comment tool · Click a clip to comment on that moment, or anywhere on the timeline · ${shortcuts.title('select')}`:groupTool?'Draw group · Drag a frame · Release to create · Esc cancels':panTool?`Hand tool · Drag anywhere to pan · ${shortcuts.title('select')}`:cutTool?`Cut tool · Click a filmstrip to split · ${shortcuts.title('select')}`:editor.notice||`Drag to select · Space + drag to pan · ${shortcuts.title('fit')} · Right-click for group actions`}</span><span>{graph.nodes.length} clips · Blue: start ref · Green: end ref</span></div>
    {context&&createPortal(<div ref={menu} className="story-context-menu" role="menu" aria-label={context.colors?(context.groupId?"Group color":"Clip color"):context.templates?"Add template":context.groupId?"Group actions":context.edgeId?"Connection actions":context.id?"Clip actions":"Timeline actions"} style={{left:context.x,top:context.y}} onKeyDown={e=>{
      if(e.key==='Escape'){e.preventDefault();setContext(null);scroll.current?.focus({preventScroll:true});}
      if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
      if(e.key==='Tab')setContext(null);
    }}>{context.templates?<>
      <button role="menuitem" onClick={()=>setContext({...context,templates:false})}>‹ Back</button>
      {builtInTemplates.map(t=><button key={t.id} role="menuitem" onClick={()=>contextAction(()=>editor.insertTemplate(t.id,contextConnectionId,context.point,context.id))}><LayoutTemplate size={14}/>{t.name}</button>)}
      {graph.templates.map(t=><div className="story-template-row" key={t.id}><button role="menuitem" onClick={()=>contextAction(()=>editor.insertTemplate(t,contextConnectionId,context.point,context.id))}>{t.name}</button><button role="menuitem" aria-label={`Delete template ${t.name}`} onClick={()=>editor.change({...graph,templates:graph.templates.filter(x=>x.id!==t.id)})}><Trash2 size={13}/></button></div>)}
    </>:<>
      {!context.colors&&!context.edgeId&&!context.groupId&&(contextNode?.source?.kind??contextNode?.mediaKind)==='image'&&<button role="menuitem" disabled={!contextNode?.source?.assetId||editor.projects.getSnapshot().busy} onClick={()=>contextAction(()=>setDrawing(contextNode?.source?.assetId))}><Paintbrush size={14} aria-hidden/>Draw on image…</button>}
      {context.id&&context.colors?<>
      <button role="menuitem" onClick={()=>setContext({...context,colors:false})}>‹ Clip actions</button>
      {(Object.keys(clipColors) as ClipColor[]).map(color=><button key={color} role="menuitemradio" aria-checked={editor.selected.every(id=>(graph.nodes.find(n=>n.id===id)?.color??'gray')===color)} onClick={()=>contextAction(()=>editor.colorClips(color))}><i className="group-color-swatch" style={{background:clipColors[color]}}/>{clipColorName(color)}{editor.selected.every(id=>(graph.nodes.find(n=>n.id===id)?.color??'gray')===color)&&<Check size={13}/>}</button>)}
    </>:contextGroup&&context.colors?<>
      <button role="menuitem" onClick={()=>setContext({...context,colors:false})}>‹ Group actions</button>
      {Object.entries(groupColors).map(([color,value])=><button key={color} role="menuitemradio" aria-checked={contextGroup.color===color} onClick={()=>contextAction(()=>editor.patchGroup(contextGroup.id,{color:color as keyof typeof groupColors}))}><i className="group-color-swatch" style={{background:value}}/>{color[0].toUpperCase()+color.slice(1)}</button>)}
    </>:contextGroup?<>
      <button role="menuitem" onClick={()=>contextAction(()=>focusGroupName(context.groupId!))}>Rename group</button>
      <button role="menuitem" onClick={()=>setContext({...context,colors:true})}>Change color</button>
      <button role="menuitem" disabled={!contextGroup.nodeIds.length} onClick={()=>contextAction(()=>editor.patchGroup(contextGroup.id,{bounds:undefined}))}>Fit to contents</button>
      <button role="menuitem" disabled={!membersToAdd.length} onClick={()=>contextAction(()=>editor.changeGroupMembers(contextGroup.id,[...contextGroup.nodeIds,...membersToAdd]))}>Add selected clips</button>
      <button role="menuitem" onClick={()=>contextAction(editor.duplicate)}><Copy size={14}/>Duplicate group <kbd>{shortcuts.label('duplicate')}</kbd></button>
      <button role="menuitem" disabled={!contextGroup.nodeIds.length} onClick={()=>{setContext(null);setTemplateName(contextGroup.name);}}>Save group as template</button>
      <div role="separator"/><button role="menuitem" onClick={()=>contextAction(()=>editor.ungroup(contextGroup.id))}><Trash2 size={14}/><span>Remove group<small className="group-menu-hint">Keep clips and connections</small></span></button>
    </>:context.edgeId?<><button role="menuitem" onClick={()=>contextAction(()=>editor.selectConnection(context.edgeId!))}>Edit crossfade</button><button role="menuitem" onClick={()=>contextAction(()=>addReroute(context.edgeId!,context.point))}>Add reroute point</button>{context.pointId&&<button role="menuitem" onClick={()=>contextAction(()=>removeReroute(context.edgeId!,context.pointId!))}>Remove reroute point</button>}<button role="menuitem" onClick={()=>contextAction(()=>editor.change({...graph,edges:graph.edges.map(e=>e.id===context.edgeId?{...e,points:undefined}:e)}))}>Reset wire shape</button><button role="menuitem" onClick={()=>contextAction(editor.disconnect)}>Disconnect</button></>:context.id?<>
      {outputPorts(graph,position(context.id)).map(port=><button key={port.id} role="menuitem" onClick={()=>contextAction(()=>editor.setConnecting({from:context.id!,edgeId:port.edgeId,conditionId:port.conditionId}))}>
        {behaviors(position(context.id!)).conditional?`Connect ${port.label||'Unnamed condition'} to clip…`:'Connect to clip…'}
      </button>)}
      <button role="menuitem" aria-haspopup="menu" onClick={()=>setContext({...context,colors:true})}><Palette size={14}/>Clip color</button><button role="menuitem" disabled={!canCutAtPlayhead} onClick={()=>contextAction(()=>editor.split(context.id))}><Scissors size={14}/>Cut at playhead <kbd>{shortcuts.label('split')}</kbd></button><button role="menuitem" onClick={()=>contextAction(editor.duplicate)}><Copy size={14}/>Duplicate <kbd>{shortcuts.label('duplicate')}</kbd></button><button role="menuitem" disabled={graph.entryId===context.id} onClick={()=>contextAction(()=>editor.setStartVideo(context.id!))}><Flag size={14}/>{graph.entryId===context.id?'Start video':'Set as start video'}</button><button role="menuitem" onClick={()=>{setContext(null);setTemplateName('My template');}}>Save as template</button><button role="menuitem" onClick={()=>contextAction(editor.remove)}><Trash2 size={14}/>Delete clip <kbd>{shortcuts.label('delete')}</kbd></button></>:<><button role="menuitem" onClick={()=>contextAction(()=>editor.add('simple',undefined,context.point))}>Add video</button><button role="menuitem" onClick={()=>contextAction(()=>editor.addMedia('image',context.point))}>Add image</button><button role="menuitem" onClick={()=>contextAction(()=>editor.addMedia('audio',context.point))}>Add audio</button></>}
      {!context.edgeId&&!context.colors&&<button role="menuitem" className="story-join" aria-disabled={!!editor.joinReasons.length} aria-describedby={`${canvasId}-join-help`} title={editor.joinReasons.length?'Join unavailable · Click to see all reasons':undefined} onClick={joinSelected}><Combine size={14}/>Join selected clips{editor.joinReasons.length>0&&<small>Why?</small>}</button>}
      {!context.colors&&context.commentAnchor&&<button role="menuitem" onClick={()=>contextAction(()=>openCommentDraft(context.commentAnchor!))}><MessageSquarePlus size={14}/>{isClipAnchor(context.commentAnchor)?'Comment on this moment':'Add comment'}<kbd>{shortcuts.label('comment')}</kbd></button>}
      {!context.colors&&<button role="menuitem" aria-haspopup="menu" onClick={()=>setContext({...context,templates:true})}><LayoutTemplate size={14}/>Add template</button>}
      {!context.colors&&!context.id&&!context.edgeId&&!context.groupId&&<button role="menuitem" disabled={!orphaned.length} title="Select clips that cannot be reached from the start video" onClick={()=>contextAction(selectOrphaned)}>Select orphaned clips</button>}
      {!context.colors&&!context.edgeId&&!context.groupId&&<><div role="separator"/><button role="menuitem" disabled={!editor.selected.length} onClick={()=>contextAction(()=>editor.groupSelection())}>Group selection <kbd>{shortcuts.label('group')}</kbd></button>
        {contextMemberGroup&&<button role="menuitem" onClick={()=>contextAction(()=>editor.removeFromGroup(contextMemberGroup.id,editor.selected))}>Remove from group</button>}
        <button role="menuitem" disabled={!graph.groups?.some(g=>g.nodeIds.some(id=>editor.selected.includes(id)))} onClick={()=>contextAction(()=>editor.ungroup())}>Ungroup selected clips <kbd>{shortcuts.label('ungroup')}</kbd></button></>}
      {!context.colors&&<><div role="separator"/><button role="menuitem" onClick={()=>contextAction(cleanup)}>Clean up layout <kbd>{shortcuts.label('layout')}</kbd></button><button role="menuitem" onClick={()=>contextAction(fitSelected)}>Fit <kbd>{shortcuts.label('fit')}</kbd></button></>}</>}</div>,document.fullscreenElement??document.body)}
    {templateName!==null&&<ModalBackdrop labelledBy="template-title" onCancel={()=>setTemplateName(null)} restoreFocus={()=>scroll.current?.focus({preventScroll:true})}><form className="project-card" onSubmit={e=>{e.preventDefault();editor.saveTemplate(templateName);setTemplateName(null);}}><h2 id="template-title">Save selected clips as a template</h2><p className="hint">Saves the group’s layout, clips, settings and internal connections. Imported clips reuse their footage; generated clips start as drafts.</p><label className="field">Template name<input autoFocus required maxLength={200} value={templateName} onChange={e=>setTemplateName(e.target.value)}/></label><div className="close-project-actions"><button type="button" className="button" onClick={()=>setTemplateName(null)}>Cancel</button><button className="button primary" type="submit">Save template</button></div></form></ModalBackdrop>}
    {commentEditor&&(()=>{
      const comment=commentEditor.id?comments.find(c=>c.id===commentEditor.id):undefined;if(commentEditor.id&&!comment)return null;
      const anchor=comment?.anchor??commentEditor.anchor,place=commentPlace(anchor);
      const restore=(id?:string)=>{commentFocus.current=id??null;};
      let created:string|undefined;
      return <CommentPopover key={commentEditor.id??'new'} comment={comment} location={place?.location??'Timeline'} pin={()=>commentPin(commentEditor.id)}
        color={comment?comment.color:commentEditor.color} onColor={color=>{if(comment)editor.updateComment(comment.id,{color});else setCommentEditor(current=>current&&{...current,color});}}
        onSeek={isClipAnchor(anchor)?()=>seekComment(anchor):undefined}
        onSave={text=>{if(comment)editor.updateComment(comment.id,{text});else created=editor.addComment(anchor,text,commentEditor.color);}}
        onResolve={resolved=>{if(comment)editor.updateComment(comment.id,{resolved});}}
        onDelete={()=>{if(!comment)return;editor.removeComment(comment.id);setCommentEditor(null);restore();}}
        onClose={focus=>{setCommentEditor(null);if(focus)restore(comment?.id??created);}}/>;
    })()}
    {drawing&&<ImageDrawingDialog key={drawing} assetId={drawing} projects={editor.projects} onSaved={asset=>editor.selectLibrary({type:'asset',id:asset.assetId})} onClose={()=>setDrawing(undefined)} restoreFocus={()=>scroll.current?.focus({preventScroll:true})}/>}
    {joinError&&<ModalBackdrop labelledBy="join-error-title" onCancel={()=>setJoinError(null)} restoreFocus={()=>scroll.current?.focus({preventScroll:true})}><section className="project-card story-join-dialog">
      <h2 id="join-error-title">Can’t join clips</h2><p className="hint">Resolve {joinError.length===1?'this issue':'these issues'} to join the selected clips.</p>
      <ul className="story-join-reasons">{joinError.map(reason=><li key={reason}>{reason}</li>)}</ul>
      <div className="close-project-actions"><button autoFocus type="button" className="button primary" onClick={()=>setJoinError(null)}>OK</button></div>
    </section></ModalBackdrop>}
  </div>;
}
