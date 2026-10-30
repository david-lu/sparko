import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Copy, Hand, Focus, GitBranch, GripVertical, ImageOff, LayoutTemplate, Maximize, Minus, Plus, Repeat2, Scissors, Trash2, Upload } from 'lucide-react';
import { TIMELINE_FPS } from '../../../shared/constants';
import { isGenerating } from '../../../shared/interstitials';
import { formatTime } from '../../../shared/contracts';
import type { CallResponseFlow, PlaybackSession } from '../call-response/model';
import { sceneFrames } from '../call-response/model';
import { assets } from '../project/assets';
import VideoFilmstrip from '../timeline/VideoFilmstrip';
import ClipLoading, { ClipJobStatus } from '../../shared/ClipLoading';
import ResizeHandle from '../../shared/ResizeHandle';
import { phaseLabel } from '../interstitials/status';
import { autoLayout, CLIP_HEIGHT, connect, createNode, freshId, nodeDuration, nodeMediaLayout, PIXELS_PER_SECOND, reachableNodes, groupColors, type StoryNode, type StoryEdge } from './model';
import type { StoryEditor } from './useStoryEditor';
import { builtInTemplates, instantiateTemplate, makePreset } from './templates';
import { STORY_DRAG_TYPE, readLibraryDrag, startLibraryDrag, type LibraryItem } from './libraryDrag';
import { edgeVelocity, fitCamera, gridSpacing, toScreen, toWorld, zoomAt, type Camera, type Point } from './viewport';
import { linkGeometry } from './links';
import { connectionReference } from './references';
import { sceneMediaRange } from './mediaRange';
import { moveClips } from './groups';
import { behaviors, behaviorLabel, outputPorts, outputOffset, type OutputPort } from './behaviors';
import './styles.css';
import './groups.css';

export default function StoryCanvas({editor,flow,session,height,maxHeight,onHeight}:{editor:StoryEditor;flow:CallResponseFlow;session:PlaybackSession|null;height:number;maxHeight:number;onHeight:(height:number)=>void}) {
  const videoInput=useRef<HTMLInputElement>(null),[fileDrag,setFileDrag]=useState(false);
  const graph=editor.graph!,scroll=useRef<HTMLDivElement>(null),root=useRef<HTMLDivElement>(null),addMenu=useRef<HTMLDetailsElement>(null),templateMenu=useRef<HTMLDetailsElement>(null);
  const [camera,setCamera]=useState<Camera>({x:0,y:0,zoom:1,rowScale:1}),cameraRef=useRef(camera),[size,setSize]=useState({width:800,height:280}),[drag,setDrag]=useState<Record<string,Point>|null>(null);
  const [templateName,setTemplateName]=useState<string|null>(null),[follow,setFollow]=useState(false);
  const [wire,setWire]=useState<{anchor:string;reverse?:boolean;edgeId?:string;conditionId?:string;x:number;y:number}|null>(null);
  const [panTool,setPanTool]=useState(false),[spaceHeld,setSpaceHeld]=useState(false),space=useRef({held:false,used:false}),[panning,setPanning]=useState(false);
  const [marquee,setMarquee]=useState<{start:Point;end:Point}|null>(null),gestureCancel=useRef<(()=>void)|null>(null);
  const [cutTool,setCutTool]=useState(false),[cutPreview,setCutPreview]=useState<{id:string;frame:number}|null>(null);
  const [context,setContext]=useState<{id?:string;groupId?:string;edgeId?:string;pointId?:string;frame:number;x:number;y:number;point:Point}|null>(null),menu=useRef<HTMLDivElement>(null);
  const suppressClick=useRef(false),lastFocusRevision=useRef(editor.focusRevision);
  const [movePreview,setMovePreview]=useState<{ids:string[];dx:number;dy:number}|null>(null);
  const [routeDrag,setRouteDrag]=useState<{edgeId:string;pointId:string;point:Point}|null>(null);
  const [dropTarget,setDropTarget]=useState<string|null>(null),[dropPoint,setDropPoint]=useState<Point|null>(null),[libraryDrag,setLibraryDrag]=useState<LibraryItem|null>(null);
  const library=editor.projects.getSnapshot().project?.library;
  const dragPreview=useMemo(()=>{
    if(!libraryDrag)return [];
    if('kind' in libraryDrag){const {node,item}=createNode(libraryDrag.kind);return [{...node,x:0,y:0,duration:nodeDuration(node,[item])}];}
    if('assetId' in libraryDrag){const asset=library?.find(a=>a.assetId===libraryDrag.assetId);return asset?.duration?[{id:asset.assetId,name:asset.name,kind:'source',x:0,y:0,duration:((asset.outFrame??asset.duration*TIMELINE_FPS)-(asset.inFrame??0))/TIMELINE_FPS}]:[];}
    const template=graph.templates.find(t=>t.id===libraryDrag.templateId)??(builtInTemplates.some(t=>t.id===libraryDrag.templateId)?makePreset(libraryDrag.templateId):undefined);
    if(!template)return [];
    const preview=instantiateTemplate({version:1,entryId:'',nodes:[],edges:[],templates:[]},template,[],undefined,{x:0,y:0});
    return preview.graph.nodes.map(n=>({...n,duration:nodeDuration(n,preview.items)}));
  },[libraryDrag,graph.templates,library]);
  useEffect(()=>{
    const start=(event:DragEvent)=>{if(event.dataTransfer)setLibraryDrag(readLibraryDrag(event.dataTransfer));};
    const end=()=>{setFileDrag(false);setLibraryDrag(null);setDropTarget(null);setDropPoint(null);if(addMenu.current)addMenu.current.open=false;if(templateMenu.current)templateMenu.current.open=false;};
    window.addEventListener('dragstart',start);window.addEventListener('dragend',end);window.addEventListener('drop',end);
    return()=>{window.removeEventListener('dragstart',start);window.removeEventListener('dragend',end);window.removeEventListener('drop',end);};
  },[]);
  const hovering=useRef(false);
  const reached=useMemo(()=>reachableNodes(graph),[graph]);
  const durations=Object.fromEntries(graph.nodes.map(n=>[n.id,nodeDuration(n,editor.items)]));
  const layouts=Object.fromEntries(graph.nodes.map(n=>[n.id,nodeMediaLayout(n,editor.items)]));
  const clipLeft=(n:StoryNode)=>n.x-layouts[n.id].before*PIXELS_PER_SECOND;
  const clipRight=(n:StoryNode)=>n.x+(layouts[n.id].body+layouts[n.id].after)*PIXELS_PER_SECOND;
  const frameAt=(node:StoryNode,x:number,bounds:{left:number;width:number})=>Math.round(((x-bounds.left)/bounds.width*layouts[node.id].total-layouts[node.id].before)*flow.fps);
  const nodes=graph.nodes.map(n=>drag?.[n.id]?{...n,...drag[n.id]}:n);
  const {zoom}=camera,gridX=gridSpacing(zoom),gridY=gridSpacing(camera.rowScale);
  const position=(id:string)=>nodes.find(n=>n.id===id)!;
  const updateCamera=(value:Camera|((current:Camera)=>Camera))=>{const next=typeof value==='function'?value(cameraRef.current):value;cameraRef.current=next;setCamera(next);};
  const localPoint=(client:Point)=>{const bounds=scroll.current!.getBoundingClientRect();return {x:client.x-bounds.left,y:client.y-bounds.top};};
  const fit=(targets:StoryNode[]=nodes,maxZoom=2,edges=graph.edges)=>{
    if(!targets.length||!scroll.current)return;
    const ids=new Set(targets.map(n=>n.id)),points=edges.filter(e=>ids.has(e.from)&&ids.has(e.to)).flatMap(e=>e.points??[]);
    const bounds={left:Math.min(...targets.map(clipLeft),...points.map(p=>p.x)),right:Math.max(...targets.map(clipRight),...points.map(p=>p.x)),
      top:Math.min(...targets.map(n=>n.y),...points.map(p=>p.y)),bottom:Math.max(...targets.map(n=>n.y),...points.map(p=>p.y))};
    const outputSpace=targets.some(n=>behaviors(n).conditional)?110:0;
    updateCamera(fitCamera(bounds,scroll.current.clientWidth-outputSpace,scroll.current.clientHeight,maxZoom,graph.groups?.some(g=>g.nodeIds.every(id=>ids.has(id)))));
  };
  const fitSelected=()=>fit(nodes.filter(n=>editor.selected.includes(n.id)),8);
  const cleanup=()=>{const next=autoLayout(graph,editor.items,scroll.current?.clientHeight);editor.change(next);fit(next.nodes,2,next.edges);editor.setNotice('Layout cleaned up. Connections and clip timing are unchanged.');};
  const focus=(id=editor.selectedId)=>{if(!id&&editor.selectedGroup){fit(nodes.filter(n=>editor.selectedGroup!.nodeIds.includes(n.id)));return;}const n=nodes.find(n=>n.id===id),view=scroll.current;if(!n||!view)return;
    updateCamera(current=>({...current,x:view.clientWidth/2-((clipLeft(n)+clipRight(n))/2)*current.zoom,y:(view.clientHeight-CLIP_HEIGHT)/2-n.y*current.rowScale}));};
  const reveal=(id:string)=>{const n=nodes.find(n=>n.id===id),view=scroll.current;if(!n||!view)return;const p=toScreen({x:clipLeft(n),y:n.y},cameraRef.current);
    if(p.x+layouts[n.id].total*PIXELS_PER_SECOND*cameraRef.current.zoom<24||p.x>view.clientWidth-24||p.y+CLIP_HEIGHT<24||p.y>view.clientHeight-24)focus(id);};
  useLayoutEffect(()=>{
    const view=scroll.current;if(!view)return;let opening=true,frame=0;
    const resize=()=>{setSize({width:view.clientWidth,height:view.clientHeight});
      // Let restored docked panels settle before the initial fit. Later resizes keep the user's view.
      if(opening){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{opening=false;fit();});}};
    const observer=new ResizeObserver(resize);observer.observe(view);resize();fit();
    return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[]);
  useEffect(()=>{if(lastFocusRevision.current===editor.focusRevision)return;lastFocusRevision.current=editor.focusRevision;focus();},[editor.focusRevision]);
  useEffect(()=>()=>gestureCancel.current?.(),[]);
  useEffect(()=>{
    const down=(event:KeyboardEvent)=>{
      const target=event.target as HTMLElement;
      if(target.closest('.story-edges [role="button"]'))return;
      if(event.code!=='Space'||target.closest('input,textarea,select,video[controls],[role="menu"]')||target.isContentEditable||!scroll.current?.contains(target)&&!hovering.current||target.closest('button,summary,[role="button"]')&&!hovering.current)return;
      event.preventDefault();event.stopImmediatePropagation();if(!event.repeat){space.current={held:true,used:false};setSpaceHeld(true);}
    };
    const up=(event:KeyboardEvent)=>{if(event.code!=='Space'||!space.current.held)return;event.preventDefault();if(!space.current.used)editor.player.togglePlayback();space.current={held:false,used:false};setSpaceHeld(false);};
    const blur=()=>{space.current={held:false,used:false};setSpaceHeld(false);gestureCancel.current?.();};
    window.addEventListener('keydown',down,true);window.addEventListener('keyup',up,true);window.addEventListener('blur',blur);
    return()=>{window.removeEventListener('keydown',down,true);window.removeEventListener('keyup',up,true);window.removeEventListener('blur',blur);};
  },[editor.player]);
  useEffect(()=>{
    if(!context)return;menu.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    const close=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node))setContext(null);};
    window.addEventListener('pointerdown',close,true);return()=>window.removeEventListener('pointerdown',close,true);
  },[context]);
  useEffect(()=>{
    if(!follow||!session||!scroll.current||gestureCancel.current)return;
    const node=graph.nodes.find(n=>n.id===session.sceneId),view=scroll.current;if(!node)return;
    const p=toScreen({x:node.x+session.frame/flow.fps*PIXELS_PER_SECOND,y:node.y},cameraRef.current),margin=Math.min(70,view.clientWidth/4);
    let next=cameraRef.current;
    if(p.x<margin||p.x>view.clientWidth-margin)next={...next,x:next.x+view.clientWidth/3-p.x};
    if(p.y<30||p.y+CLIP_HEIGHT>view.clientHeight-20)next={...next,y:(view.clientHeight-CLIP_HEIGHT)/2-node.y*next.rowScale};
    if(next!==cameraRef.current)updateCamera(next);
  },[follow,session?.sceneId,session?.frame,graph]);
  useEffect(()=>{
    const element=scroll.current;if(!element)return;
    const wheel=(event:WheelEvent)=>{
      event.preventDefault();const current=cameraRef.current,unit=event.deltaMode===1?16:event.deltaMode===2?element.clientHeight:1;
      if(event.ctrlKey||event.metaKey)updateCamera(zoomAt(current,current.zoom*Math.exp(-event.deltaY*unit*.002),localPoint({x:event.clientX,y:event.clientY})));
      else updateCamera({...current,x:current.x-(event.shiftKey&&!event.deltaX?event.deltaY:event.deltaX)*unit,y:current.y-(event.shiftKey&&!event.deltaX?0:event.deltaY)*unit});
    };
    element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);
  },[]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      const target=event.target as HTMLElement;if(target.isContentEditable||target.closest('input,textarea,select,dialog,video[controls],[role="menu"],.sidePanelSectionHeader')||event.altKey)return;
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d'){event.preventDefault();editor.duplicate();return;}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='g'){event.preventDefault();if(event.shiftKey)editor.ungroup();else editor.groupSelection();return;}
      if(event.ctrlKey||event.metaKey)return;
      if(event.key==='Escape'){editor.setConnecting(null);setTemplateName(null);setCutTool(false);setCutPreview(null);setContext(null);if(addMenu.current)addMenu.current.open=false;if(templateMenu.current)templateMenu.current.open=false;return;}
      if((event.key==='Delete'||event.key==='Backspace')&&target.closest('[data-reroute-id]'))return;
      if(event.key==='Delete'||event.key==='Backspace'){if(editor.selected.length||editor.selectedEdge){event.preventDefault();event.stopImmediatePropagation();editor.remove();}return;}
      if(event.shiftKey&&event.key.toLowerCase()==='f'){event.preventDefault();fitSelected();return;}
      if(event.key==='Home'&&target===scroll.current){event.preventDefault();fit();return;}
      if(event.key.toLowerCase()==='h'){event.preventDefault();setPanTool(v=>!v);setCutTool(false);return;}
      if(event.key.toLowerCase()==='v'){event.preventDefault();setCutTool(false);setPanTool(false);setCutPreview(null);return;}
      if(event.defaultPrevented||target.closest('button,a,summary'))return;
      if(event.key.toLowerCase()==='n'){event.preventDefault();editor.add('simple');}
      if(event.key.toLowerCase()==='s'){event.preventDefault();editor.split();}
      if(event.key.toLowerCase()==='c'){event.preventDefault();setCutTool(v=>!v);setPanTool(false);}
      if(event.key.toLowerCase()==='a'){event.preventDefault();cleanup();}
    };window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
  },[editor,graph]);
  const menuAdd=(event:React.MouseEvent,action:()=>void)=>{
    if(event.detail===0){action();if(addMenu.current)addMenu.current.open=false;if(templateMenu.current)templateMenu.current.open=false;}
    else editor.setNotice('Drag an interstitial or template onto the timeline to place it. Drop onto a clip or wire to attach it.');
  };
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
  const trackGesture=(event:React.PointerEvent<HTMLElement|SVGElement>,onMove:(point:Point)=>void,onCommit:(moved:boolean)=>void,onCancel:()=>void,autoPan=false)=>{
    gestureCancel.current?.();event.preventDefault();event.stopPropagation();window.getSelection()?.removeAllRanges();
    const target=event.currentTarget,pointerId=event.pointerId,start={x:event.clientX,y:event.clientY};let point=start,moved=false,raf=0,last=performance.now();
    target.setPointerCapture(pointerId);
    const apply=()=>onMove(localPoint(point));
    const tick=(now:number)=>{
      const seconds=Math.min(.05,(now-last)/1000);last=now;
      if(autoPan&&moved&&scroll.current){const p=localPoint(point),vx=edgeVelocity(p.x,scroll.current.clientWidth),vy=edgeVelocity(p.y,scroll.current.clientHeight);
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
  const displayedPoints=(connection:StoryEdge)=>(connection.points??[]).map(p=>{
    if(routeDrag?.pointId===p.id&&routeDrag.edgeId===connection.id)return {...p,...routeDrag.point};
    if(movePreview?.ids.includes(connection.from)&&movePreview.ids.includes(connection.to))return {...p,x:p.x+movePreview.dx,y:p.y+movePreview.dy};
    return p;
  });
  const outputPoint=(node:StoryNode,edgeId?:string,conditionId?:string)=>{
    const ports=outputPorts(graph,node),index=Math.max(0,ports.findIndex(p=>edgeId?p.edgeId===edgeId:conditionId?p.conditionId===conditionId:p.id==='next'));
    const p=toScreen({x:clipRight(node),y:node.y},camera);return {...p,y:p.y+(behaviors(node).conditional?outputOffset(ports.length,index):CLIP_HEIGHT/2)};
  };
  const groupViews=(graph.groups??[]).flatMap(group=>{
    const members=nodes.filter(n=>group.nodeIds.includes(n.id));if(!members.length)return [];
    const points=graph.edges.filter(e=>group.nodeIds.includes(e.from)&&group.nodeIds.includes(e.to)).flatMap(displayedPoints).map(p=>toScreen(p,camera));
    const left=Math.min(...members.map(n=>clipLeft(n)*zoom+camera.x),...points.map(p=>p.x))-18;
    const right=Math.max(...members.map(n=>clipRight(n)*zoom+camera.x+(behaviors(n).conditional?110:0)),...points.map(p=>p.x))+18;
    const top=Math.min(...members.map(n=>n.y*camera.rowScale+camera.y),...points.map(p=>p.y))-38;
    const bottom=Math.max(...members.map(n=>n.y*camera.rowScale+camera.y+CLIP_HEIGHT),...points.map(p=>p.y))+28;
    return [{group,left,top,width:right-left,height:bottom-top}];
  });
  const focusGroupName=(id:string)=>{editor.selectGroup(id);requestAnimationFrame(()=>{const input=document.getElementById('story-group-name') as HTMLInputElement|null;input?.focus();input?.select();});};
  const geometry=(connection:StoryEdge)=>{
    const from=position(connection.from),to=position(connection.to);
    const start=outputPoint(from,connection.id),end=toScreen({x:clipLeft(to),y:to.y},camera);
    end.y+=CLIP_HEIGHT/2;
    const points=displayedPoints(connection);
    return {...linkGeometry(start,end,points.map(p=>toScreen(p,camera)),from.id===to.id),points};
  };
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
  const dragClips=(event:React.PointerEvent<HTMLButtonElement>,ids:string[])=>{
    const originalCamera=cameraRef.current,origin=toWorld(localPoint({x:event.clientX,y:event.clientY}),originalCamera);
    let dx=0,dy=0;
    trackGesture(event,point=>{const world=toWorld(point,cameraRef.current);dx=world.x-origin.x;dy=world.y-origin.y;
      setDrag(Object.fromEntries(graph.nodes.filter(n=>ids.includes(n.id)).map(n=>[n.id,{x:n.x+dx,y:n.y+dy}])));
      setMovePreview({ids,dx,dy});
    },moved=>{setDrag(null);setMovePreview(null);if(moved)editor.change(moveClips(graph,ids,Math.round(dx/8)*8,Math.round(dy/8)*8));},
      ()=>{setDrag(null);setMovePreview(null);updateCamera(originalCamera);},true);
  };
  const dragTitle=(event:React.PointerEvent<HTMLButtonElement>,node:StoryNode)=>{
    if(event.button!==0)return;
    scroll.current?.focus({preventScroll:true});
    if(event.shiftKey){event.preventDefault();event.stopPropagation();editor.select(node.id,0,true);return;}
    const ids=!editor.selectedGroup&&editor.selected.includes(node.id)?editor.selected:[node.id];
    if(editor.selectedGroup||!editor.selected.includes(node.id))editor.select(node.id,session?.sceneId===node.id?session.frame:0);
    dragClips(event,ids);
  };
  const beginAreaGesture=(event:React.PointerEvent<HTMLDivElement>)=>{
    const pan=event.button===1||event.button===0&&(panTool||space.current.held);
    const blank=!(event.target as Element).closest('[data-node-id],[data-edge-id],[data-group-id],button,input,textarea,select');
    if(!pan&&!(event.button===0&&blank))return;
    event.currentTarget.focus({preventScroll:true});setContext(null);
    const start=localPoint({x:event.clientX,y:event.clientY}),originalCamera=cameraRef.current,originalSelection=editor.selected;
    if(pan){
      space.current.used=true;setPanning(true);
      trackGesture(event,point=>updateCamera({...originalCamera,x:originalCamera.x+point.x-start.x,y:originalCamera.y+point.y-start.y}),
        moved=>{setPanning(false);if(!moved&&blank){editor.setSelected([]);editor.setSelectedEdge(null);editor.setConnecting(null);editor.jobs.select(null);}},()=>{setPanning(false);updateCamera(originalCamera);});return;
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
  const scrub=(event:React.PointerEvent<HTMLDivElement>,node:StoryNode)=>{
    if(event.button!==0)return;event.stopPropagation();if(editor.connecting){editor.attach(node.id);return;}if(event.shiftKey){editor.select(node.id,0,true);return;}
    const target=event.currentTarget,rect=target.getBoundingClientRect(),scene=flow.scenes.find(s=>s.id===node.id)!;target.focus({preventScroll:true});
    if(cutTool){editor.split(node.id,frameAt(node,event.clientX,rect));setCutPreview(null);return;}
    const seek=(x:number)=>editor.select(node.id,Math.max(0,Math.min(sceneFrames(scene)-1,frameAt(node,x,rect))));
    seek(event.clientX);target.setPointerCapture(event.pointerId);const move=(e:PointerEvent)=>seek(e.clientX);
    const end=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',end);};target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);
  };
  const drop=(event:React.DragEvent<HTMLDivElement>)=>{
    const payload=event.dataTransfer.getData(STORY_DRAG_TYPE),files=Array.from(event.dataTransfer.files);if(!payload&&(!files.length||files.some(file=>/\.sparko$/i.test(file.name))))return;event.preventDefault();event.stopPropagation();setFileDrag(false);setDropTarget(null);setDropPoint(null);
    const view=scroll.current!,bounds=view.getBoundingClientRect(),point=toWorld({x:event.clientX-bounds.left,y:event.clientY-bounds.top},cameraRef.current);
    if(files.length){void editor.importVideos(files,point);return;}
    const item=readLibraryDrag(event.dataTransfer);if(!item)return;
    if('assetId' in item){editor.addAsset(item.assetId,point);return;}
    const target=event.target as Element,fromId=target.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
    const connectionId=target.closest<SVGElement>('[data-edge-id]')?.getAttribute('data-edge-id')??(fromId?graph.edges.find(e=>e.from===fromId&&e.event==='next')?.id:undefined);
    if('kind' in item&&['simple','looped','conditional'].includes(item.kind))editor.add(item.kind,connectionId??undefined,point,fromId);
    if('templateId' in item){const template=graph.templates.find(t=>t.id===item.templateId)??builtInTemplates.find(t=>t.id===item.templateId)?.id;if(template)editor.insertTemplate(template,connectionId??undefined,point,fromId);}
  };
  const contextAction=(action:()=>void)=>{action();setContext(null);scroll.current?.focus();};
  return <div ref={root} className={`story-canvas ${wire||editor.connecting?'connecting':''} ${cutTool?'cut-tool':''} ${panTool||spaceHeld?'pan-tool':''} ${panning?'panning':''} ${dropTarget?'library-drag':''} ${libraryDrag?'dragging-library':''}`} style={{height}}>
    <ResizeHandle orientation="horizontal" label="Resize story canvas" value={height} min={220} max={maxHeight} onChange={onHeight}/>
    <div className="story-toolbar"><span className="eyebrow"><GitBranch size={14}/> STORY FLOW</span>
      <details ref={addMenu} className="story-menu"><summary className="button small"><Plus size={13}/>Interstitial</summary><div className="story-menu-popover"><p className="story-drag-help">Drag to a spot on the timeline</p><button draggable onDragStart={e=>startLibraryDrag(e,{kind:'simple'})} title="Drag to timeline. Enter adds at the selection." onClick={e=>menuAdd(e,()=>editor.add('simple',editor.selectedEdge??undefined))}><strong><GripVertical size={12}/>New interstitial</strong><small>Set loop and conditional behaviors in the Inspector</small></button></div></details>
      <details ref={templateMenu} className="story-menu"><summary className="button small"><LayoutTemplate size={13}/>Templates</summary><div className="story-menu-popover"><p className="story-drag-help">Drag to a spot on the timeline</p>{builtInTemplates.map(t=><button key={t.id} draggable onDragStart={e=>startLibraryDrag(e,{templateId:t.id})} title="Drag to timeline. Enter adds at the selection." onClick={e=>menuAdd(e,()=>editor.insertTemplate(t.id,editor.selectedEdge??undefined))}><strong><GripVertical size={12}/>{t.name}</strong><small>{t.description}</small></button>)}{graph.templates.map(t=><div className="story-template-row" key={t.id}><button draggable onDragStart={e=>startLibraryDrag(e,{templateId:t.id})} title="Drag to timeline. Enter adds at the selection." onClick={e=>menuAdd(e,()=>editor.insertTemplate(t,editor.selectedEdge??undefined))}>{t.name}</button><button aria-label={`Delete template ${t.name}`} onClick={()=>editor.change({...graph,templates:graph.templates.filter(x=>x.id!==t.id)})}><Trash2 size={13}/></button></div>)}<button disabled={!editor.selected.length} onClick={()=>{setTemplateName(editor.selectedGroup?.name??'My template');templateMenu.current!.open=false;}}>Save selected clips as template</button></div></details>
      <button className="button small" onClick={cleanup}>Auto layout</button>
      <div className="story-toolbar-spacer"/><button className="icon-button small" title="Duplicate selected clips (Ctrl/Cmd+D)" aria-label="Duplicate selected clips" disabled={!editor.selected.length} onClick={editor.duplicate}><Copy size={14}/></button>
      <button className={`icon-button small ${cutTool?'active':''}`} title="Cut tool (C). Click a clip to split it. V returns to selection." aria-label="Cut tool" aria-pressed={cutTool} onClick={()=>{setCutTool(v=>!v);setPanTool(false);}}><Scissors size={14}/></button>
      <button className={`icon-button small ${panTool?'active':''}`} aria-label="Pan tool" aria-pressed={panTool} title="Hand tool (H). Also pan with Space + drag or the middle mouse button." onClick={()=>{setPanTool(v=>!v);setCutTool(false);}}><Hand size={14}/></button>
      <button className="icon-button small" aria-label="Zoom out story" onClick={()=>updateCamera(zoomAt(cameraRef.current,zoom/1.4,{x:size.width/2,y:size.height/2}))}><Minus size={14}/></button>
      <span className="story-zoom">{Math.round(zoom*100)}%</span>
      <button className="icon-button small" aria-label="Zoom in story" onClick={()=>updateCamera(zoomAt(cameraRef.current,zoom*1.4,{x:size.width/2,y:size.height/2}))}><Plus size={14}/></button>
      <button className="button small" aria-label="Fit all" title="Fit all clips on screen (Home on the canvas)" onClick={()=>fit()}>Fit all</button>
      <button className="icon-button small" aria-label="Fit selected" aria-keyshortcuts="Shift+F" title="Fit selected clips (Shift+F)" onClick={fitSelected} disabled={!editor.selected.length}><Focus size={14}/></button><button className={`icon-button small ${follow?'active':''}`} aria-label="Follow playhead" aria-pressed={follow} onClick={()=>setFollow(v=>!v)}><Maximize size={14}/></button>
    </div>
    <div className="story-scroll" ref={scroll} tabIndex={0} aria-label="Clip graph" onPointerEnter={()=>{hovering.current=true;}} onPointerLeave={()=>{hovering.current=false;}} style={{backgroundPosition:`${camera.x}px ${camera.y}px`,backgroundSize:`${gridX*4}px ${gridY*4}px, ${gridX}px ${gridY}px`}} onPointerDownCapture={beginAreaGesture} onFocusCapture={e=>{const id=(e.target as Element).closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;if(id)reveal(id);}} onDrop={drop} onDragOver={e=>{if(!e.dataTransfer.types.includes(STORY_DRAG_TYPE)&&!e.dataTransfer.types.includes('Files'))return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy';setFileDrag(e.dataTransfer.types.includes('Files'));setDropPoint(localPoint({x:e.clientX,y:e.clientY}));const el=e.target as Element;setDropTarget(el.closest('[data-edge-id]')?.getAttribute('data-edge-id')??el.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId??'canvas');}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)){setFileDrag(false);setDropTarget(null);setDropPoint(null);}}} onContextMenu={e=>{
      e.preventDefault();const clip=(e.target as Element).closest<HTMLElement>('[data-node-id]'),id=clip?.dataset.nodeId,scene=flow.scenes.find(s=>s.id===id),bounds=clip?.getBoundingClientRect();
      const frame=scene&&bounds?Math.max(0,Math.min(sceneFrames(scene)-1,frameAt(graph.nodes.find(n=>n.id===id)!,e.clientX,bounds))):0;
      const edgeId=(e.target as Element).closest('[data-edge-id]')?.getAttribute('data-edge-id')??undefined,pointId=(e.target as Element).closest('[data-reroute-id]')?.getAttribute('data-reroute-id')??undefined;
      if(edgeId){editor.setSelectedEdge(edgeId);editor.setSelected([]);}if(id&&(editor.selectedGroup||!editor.selected.includes(id)))editor.select(id,frame);
      const point=localPoint({x:e.clientX,y:e.clientY}),groupId=!id&&!edgeId?((e.target as Element).closest<HTMLElement>('[data-group-id]')?.dataset.groupId??groupViews.find(g=>point.x>=g.left&&point.x<=g.left+g.width&&point.y>=g.top&&point.y<=g.top+g.height)?.group.id):undefined;
      if(groupId)editor.selectGroup(groupId);setContext({id,groupId,edgeId,pointId,frame,x:Math.max(8,Math.min(e.clientX,window.innerWidth-240)),y:Math.max(8,Math.min(e.clientY,window.innerHeight-370)),point:toWorld(localPoint({x:e.clientX,y:e.clientY}),cameraRef.current)});
    }}>
      {!nodes.length&&!fileDrag&&<div className="story-empty"><Upload size={22}/><strong>Drop video files here</strong><span>Each video becomes a separate clip.</span><button className="button small" onClick={()=>videoInput.current?.click()}>Import videos</button></div>}
      {fileDrag&&dropPoint&&<div className="story-file-drop" style={{left:dropPoint.x,top:dropPoint.y}}><Upload size={14}/><span>Import clips here</span></div>}
      <div className="story-world">
        {groupViews.map(({group,left,top,width,height})=><div key={group.id} data-group-id={group.id} className={`story-group ${editor.selectedGroup?.id===group.id?'selected':''}`}
          style={{left,top,width,height,'--group-color':groupColors[group.color]} as React.CSSProperties}>
          <button className="story-group-header" aria-label={`Select group ${group.name}`} title="Drag to move the group. Double-click to rename. Right-click for group actions."
            onPointerDown={e=>{if(e.button!==0||panTool||space.current.held)return;editor.selectGroup(group.id);scroll.current?.focus({preventScroll:true});dragClips(e,group.nodeIds);}}
            onClick={e=>{if(e.detail===0)editor.selectGroup(group.id);}} onDoubleClick={()=>focusGroupName(group.id)}
            onKeyDown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();const step=e.shiftKey?32:8;editor.change(moveClips(graph,group.nodeIds,e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0));}}}>
            <LayoutTemplate size={13}/><span>{group.name}</span><small>{group.nodeIds.length} {group.nodeIds.length===1?'clip':'clips'}</small>
          </button>
        </div>)}
        {dropPoint&&dragPreview.map(n=><div key={n.id} className={`story-drop-preview type-${n.kind}`} aria-hidden style={{left:dropPoint.x+n.x*zoom,top:dropPoint.y+n.y*camera.rowScale,width:n.duration*PIXELS_PER_SECOND*zoom,height:CLIP_HEIGHT}}><div className="story-clip-title"><span>{n.name}</span><small>{n.duration.toFixed(1)}s</small></div><div className="story-drop-filmstrip"/></div>)}
        <svg className="story-edges" width={size.width} height={size.height} aria-label="Clip connections"><defs><linearGradient id="story-fade-ramp"><stop offset="0" stopColor="currentColor" stopOpacity=".15"/><stop offset="1" stopColor="currentColor"/></linearGradient><marker id="story-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7Z" fill="currentColor"/></marker><marker id="story-arrow-mismatch" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7Z" fill="#f17c76"/></marker></defs>
          {wire&&position(wire.anchor)&&(()=>{const node=position(wire.anchor),anchor=wire.reverse?toScreen({x:clipLeft(node),y:node.y},camera):outputPoint(node,wire.edgeId,wire.conditionId);if(wire.reverse)anchor.y+=CLIP_HEIGHT/2;return <path className="story-edge-line story-wire" d={wire.reverse?linkGeometry(wire,anchor).path:linkGeometry(anchor,wire).path}/>;})()}
          {graph.edges.map(connection=>{const from=position(connection.from),to=position(connection.to);if(!from||!to)return null;
            const self=from.id===to.id,{path:d,middle:{x:mx,y:my},points}=geometry(connection),reference=connectionReference(flow,flow.edges.find(e=>e.id===connection.id)!);
            return <g key={connection.id} data-edge-id={connection.id} data-reference-state={reference.state} className={`story-edge ${reference.state==='mismatch'?'reference-mismatch':''} ${wire?.edgeId===connection.id?'rewiring':''} ${editor.selectedEdge===connection.id||dropTarget===connection.id?'selected':''} ${session?.traversedEdgeIds.includes(connection.id)?'traversed':''}`}>
              <path className="story-edge-line" d={d} markerEnd={reference.state==='mismatch'?"url(#story-arrow-mismatch)":"url(#story-arrow)"}/><path className="story-edge-hit" d={d} tabIndex={0} role="button" aria-label={`Connection ${from.name} to ${to.name}: ${connection.label}`} aria-description={reference.message} onPointerDown={e=>beginConnection(e,from,e.shiftKey?undefined:connection.id,false,true)} onClick={()=>{if(!suppressClick.current)editor.selectConnection(connection.id);}} onDoubleClick={e=>{e.preventDefault();addReroute(connection.id,toWorld(localPoint({x:e.clientX,y:e.clientY}),cameraRef.current));}} onKeyDown={e=>{if(e.key==='Enter'){editor.selectConnection(connection.id);}}}><title>{reference.message} Drag to reconnect. Double-click to add a reroute point.</title></path>
              {connection.event!=='next'&&!behaviors(from).conditional&&<text x={mx} y={my-17} textAnchor="middle">{connection.label}</text>}
              {!self&&<g className="story-crossfade" role="button" aria-label={`Edit crossfade from ${from.name} to ${to.name}`} tabIndex={0} onClick={()=>editor.selectConnection(connection.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();editor.selectConnection(connection.id);}}}>
                <title>Edit crossfade in Inspector</title><rect x={mx-13} y={my-11} width={26} height={22} rx={5}/>
                <svg x={mx-8} y={my-6} width={16} height={12} viewBox="0 0 16 12" aria-hidden><path className="fade-ramp" d="M1 1V11H15Z"/><path className="fade-ramp" d="M15 1V11H1Z"/></svg>
              </g>}
              {points.map((point,index)=>{const p=toScreen(point,camera);return <circle key={point.id} data-reroute-id={point.id} className="story-reroute" cx={p.x} cy={p.y} r={5} tabIndex={0} role="button" aria-label={`Reroute point ${index+1} from ${from.name} to ${to.name}`}
                onPointerDown={e=>dragReroute(e,connection,point)} onDoubleClick={e=>{e.stopPropagation();removeReroute(connection.id,point.id);}}
                onKeyDown={e=>{if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();removeReroute(connection.id,point.id);}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();const step=e.shiftKey?10:1;editor.change({...graph,edges:graph.edges.map(c=>c.id===connection.id?{...c,points:c.points?.map(v=>v.id===point.id?{...v,x:v.x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),y:v.y+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0)}:v)}:c)});}}}><title>Drag to shape the wire. Double-click or Delete removes this point.</title></circle>;})}
            </g>;})}
        </svg>
        {nodes.map(node=>{const scene=flow.scenes.find(s=>s.id===node.id)!,item=editor.items.find(i=>i.id===node.interstitialId),active=session?.sceneId===node.id,selected=editor.selected.includes(node.id);
          const {assetId,start}=sceneMediaRange(scene,flow.fps),url=assets.url(assetId);
          const layout=layouts[node.id],clipWidth=layout.total*PIXELS_PER_SECOND*zoom,progress=active?(layout.before+session.frame/flow.fps)/layout.total:0;
          return <div key={node.id} className={`story-clip type-${node.kind} ${selected?'selected':''} ${active?'playing':''} ${scene.draft?'draft':''} ${reached.has(node.id)?'':'disconnected'} ${dropTarget===node.id?'drop-target':''}`} data-node-id={node.id} data-kind={node.kind} data-duration={durations[node.id]} data-media-duration={layout.total} style={{left:clipLeft(node)*zoom+camera.x,top:node.y*camera.rowScale+camera.y,width:clipWidth,height:CLIP_HEIGHT}}>
            <button className="story-clip-title" title={`${scene.label} · ${durations[node.id].toFixed(2)} seconds · Drag title to move`} onPointerDown={e=>dragTitle(e,node)} onClick={e=>{if(e.detail===0)editor.select(node.id);}}><span>{behaviors(node).loop&&<Repeat2 size={11}/>} {behaviors(node).conditional&&<GitBranch size={11}/>}{scene.label}</span><small>{durations[node.id].toFixed(1)}s</small></button>
            <div className="story-filmstrip" role="slider" tabIndex={0} aria-label={`Scrub ${scene.label}`} aria-valuemin={0} aria-valuemax={sceneFrames(scene)/flow.fps} aria-valuenow={active?session.frame/flow.fps:0} onPointerDown={e=>scrub(e,node)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End','Enter'].includes(e.key)){e.preventDefault();e.stopPropagation();const current=active?session.frame:0;editor.select(node.id,e.key==='Home'?0:e.key==='End'?sceneFrames(scene)-1:e.key==='Enter'?current:current+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?flow.fps:1));}}}>
              {scene.draft?<div className="story-unavailable-thumbnail" role="img" aria-label="Video unavailable: not generated yet" title="Not generated yet. Generate this clip in the Inspector."><ImageOff size={18} strokeWidth={1.5} aria-hidden/>{clipWidth>=90&&<span aria-hidden>Not generated</span>}</div>:url?<VideoFilmstrip assetId={assetId} url={url} start={start-layout.before} end={start+layout.body+layout.after}/>:<ClipLoading message="Loading clip"/>}
              {scene.generated&&<>
                {layout.before>0&&<span className="story-reference-section opening" role="img" aria-label={`Opening reference: ${layout.before.toFixed(3)} seconds`} style={{left:0,width:`${layout.before/layout.total*100}%`}} title="Opening reference · Used to match the previous clip">{layout.before*PIXELS_PER_SECOND*zoom>24&&<b>REF</b>}</span>}
                <span className="story-generated-section" role="img" aria-label={`Generated section: ${layout.body.toFixed(3)} seconds`} style={{left:`${layout.before/layout.total*100}%`,width:`${layout.body/layout.total*100}%`}} title="Generated section · Played in the story">{layout.body*PIXELS_PER_SECOND*zoom>70&&<b>GENERATED</b>}</span>
                {layout.after>0&&<span className="story-reference-section ending" role="img" aria-label={`Ending reference: ${layout.after.toFixed(3)} seconds`} style={{right:0,width:`${layout.after/layout.total*100}%`}} title="Ending reference · Used to match the next clip">{layout.after*PIXELS_PER_SECOND*zoom>24&&<b>REF</b>}</span>}
              </>}
              {item&&isGenerating(item)&&<ClipJobStatus label={scene.label} message={phaseLabel(item)}/>}
              {item?.phase==='error'&&<span className="story-clip-error" title={item.error}>Failed · Retry in inspector</span>}
              {cutTool&&<span className="story-cut-surface" onPointerMove={e=>{const bounds=e.currentTarget.getBoundingClientRect();setCutPreview({id:node.id,frame:Math.max(0,Math.min(sceneFrames(scene),frameAt(node,e.clientX,bounds)))});}} onPointerLeave={()=>setCutPreview(null)}/>}
              {cutTool&&cutPreview?.id===node.id&&<span className="story-cut-preview" style={{left:`${(layout.before+cutPreview.frame/flow.fps)/layout.total*100}%`}}/>}
            </div>
            <button className="story-port input" aria-label={`Connect to ${scene.label}`} title="Drag to reconnect an incoming wire. Shift-drag to connect from another output." onPointerDown={e=>beginInput(e,node)} onClick={()=>{if(!suppressClick.current)editor.attach(node.id);}}/>
            {outputPorts(graph,node).map((port,index,ports)=><button key={port.id} className={`story-port output ${behaviors(node).conditional?'conditional-output':''}`} data-condition-id={port.conditionId} data-output-id={port.id} data-default={port.isDefault}
              style={behaviors(node).conditional?{top:outputOffset(ports.length,index)}:undefined}
              aria-label={behaviors(node).conditional?`Connect ${port.label} from ${scene.label}`:`Connect from ${scene.label}`}
              title={`${port.isDefault?'Default condition. ':''}Drag ${port.label} to a clip${port.edgeId?' to reconnect':''}`}
              onPointerDown={e=>beginConnection(e,node,port.edgeId,false,true,port)}
              onClick={()=>{if(!suppressClick.current&&port.edgeId)editor.selectConnection(port.edgeId);}}>
              {behaviors(node).conditional&&<><span>{port.label||'Unnamed condition'}</span><i aria-hidden/></>}
            </button>)}
            {active&&<div className="story-playhead" style={{left:`${Math.min(100,progress*100)}%`}}><span>{formatTime(session.frame/flow.fps,true)}</span><i/></div>}
            <span className="story-clip-caption" title={!reached.has(node.id)?'Disconnected from story start':behaviorLabel(node)}>{graph.entryId===node.id?'START · ':''}{!reached.has(node.id)?'Disconnected':behaviorLabel(node)}</span>
          </div>;
        })}
        {marquee&&<div className="story-marquee" style={{left:Math.min(marquee.start.x,marquee.end.x)*zoom+camera.x,top:Math.min(marquee.start.y,marquee.end.y)*camera.rowScale+camera.y,width:Math.abs(marquee.end.x-marquee.start.x)*zoom,height:Math.abs(marquee.end.y-marquee.start.y)*camera.rowScale}}/>}
      </div>
    </div>
    <input ref={videoInput} hidden multiple type="file" accept="video/*,.mkv,.mov,.webm,.mp4" aria-label="Import videos onto timeline" onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';void editor.importVideos(files);}}/>
    <div className="story-status"><span role="status">{dropTarget?(fileDrag?'Release to import video clips here':libraryDrag&&'assetId' in libraryDrag?'Release to add a separate clip':dropTarget==='canvas'?'Release to place here':graph.edges.some(e=>e.id===dropTarget)?'Release to insert into this connection':'Release to attach to this clip'):libraryDrag?'Drag onto the timeline · Escape cancels':wire?'Drop onto a clip to connect · Escape cancels':editor.connecting?'Choose a destination input · Escape cancels':panTool?'Hand tool · Drag anywhere to pan · V returns to selection':cutTool?'Cut tool · Click a filmstrip to split · V returns to selection':editor.notice||'Drag to select · Space + drag to pan · Shift F to fit selection · Right-click for cleanup'}</span><span>{graph.nodes.length} clips · Blue: reference · Purple: generated</span></div>
    {context&&<div ref={menu} className="story-context-menu" role="menu" aria-label={context.groupId?"Group actions":context.edgeId?"Connection actions":context.id?"Clip actions":"Timeline actions"} style={{left:context.x,top:context.y}} onKeyDown={e=>{
      if(e.key==='Escape'){e.preventDefault();setContext(null);scroll.current?.focus();}
      if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
      if(e.key==='Tab')setContext(null);
    }}>{context.groupId?<>
      <button role="menuitem" onClick={()=>contextAction(()=>focusGroupName(context.groupId!))}>Rename group</button>
      <button role="menuitem" onClick={()=>contextAction(editor.duplicate)}><Copy size={14}/>Duplicate group <kbd>Ctrl D</kbd></button>
      <button role="menuitem" onClick={()=>{setContext(null);setTemplateName(editor.selectedGroup?.name??'My template');}}>Save group as template</button>
      <button role="menuitem" onClick={()=>contextAction(()=>editor.ungroup(context.groupId!))}>Ungroup · keep clips <kbd>Ctrl Shift G</kbd></button>
    </>:context.edgeId?<><button role="menuitem" onClick={()=>contextAction(()=>editor.selectConnection(context.edgeId!))}>Edit crossfade</button><button role="menuitem" onClick={()=>contextAction(()=>addReroute(context.edgeId!,context.point))}>Add reroute point</button>{context.pointId&&<button role="menuitem" onClick={()=>contextAction(()=>removeReroute(context.edgeId!,context.pointId!))}>Remove reroute point</button>}<button role="menuitem" onClick={()=>contextAction(()=>editor.change({...graph,edges:graph.edges.map(e=>e.id===context.edgeId?{...e,points:undefined}:e)}))}>Reset wire shape</button><button role="menuitem" onClick={()=>contextAction(editor.disconnect)}>Disconnect</button></>:context.id?<><button role="menuitem" disabled={context.frame===0} onClick={()=>contextAction(()=>editor.split(context.id,context.frame))}><Scissors size={14}/>Split here <kbd>S</kbd></button><button role="menuitem" onClick={()=>contextAction(editor.duplicate)}><Copy size={14}/>Duplicate <kbd>Ctrl D</kbd></button><button role="menuitem" onClick={()=>contextAction(()=>editor.change({...graph,entryId:context.id!}))}>Start story here</button><button role="menuitem" onClick={()=>{setContext(null);setTemplateName('My template');}}>Save as template</button><button role="menuitem" onClick={()=>contextAction(editor.remove)}><Trash2 size={14}/>Delete clip <kbd>Del</kbd></button></>:<><button role="menuitem" onClick={()=>contextAction(()=>editor.add('simple',undefined,context.point))}>Add interstitial</button></>}
      {!context.edgeId&&!context.groupId&&<><div role="separator"/><button role="menuitem" disabled={!editor.selected.length} onClick={()=>contextAction(()=>editor.groupSelection())}>Group selected clips <kbd>Ctrl G</kbd></button>
        <button role="menuitem" disabled={!graph.groups?.some(g=>g.nodeIds.some(id=>editor.selected.includes(id)))} onClick={()=>contextAction(()=>editor.ungroup())}>Ungroup selected clips <kbd>Ctrl Shift G</kbd></button></>}
      <div role="separator"/><button role="menuitem" onClick={()=>contextAction(cleanup)}>Clean up layout <kbd>A</kbd></button><button role="menuitem" onClick={()=>contextAction(()=>fit())}>Fit all</button><button role="menuitem" disabled={!editor.selected.length} onClick={()=>contextAction(fitSelected)}>Fit selected <kbd>Shift F</kbd></button></div>}
    {templateName!==null&&<div className="modal-backdrop"><form className="project-card" role="dialog" aria-modal="true" aria-labelledby="template-title" onKeyDown={e=>{
      if(e.key==='Escape'){e.preventDefault();setTemplateName(null);templateMenu.current?.querySelector('summary')?.focus();}
      if(e.key==='Tab'){const controls=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input,button'));if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();controls[0]?.focus();}}
    }} onSubmit={e=>{e.preventDefault();editor.saveTemplate(templateName);setTemplateName(null);templateMenu.current?.querySelector('summary')?.focus();}}><h2 id="template-title">Save selected clips as a template</h2><p className="hint">Saves the group’s layout, clips, settings and internal connections. Imported videos reuse their footage; interstitials start as drafts.</p><label className="field">Template name<input autoFocus required maxLength={200} value={templateName} onChange={e=>setTemplateName(e.target.value)}/></label><div className="close-project-actions"><button type="button" className="button" onClick={()=>{setTemplateName(null);templateMenu.current?.querySelector('summary')?.focus();}}>Cancel</button><button className="button primary" type="submit">Save template</button></div></form></div>}
  </div>;
}
