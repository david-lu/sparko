import { TIMELINE_FPS } from '../../../shared/constants';
import { playableResult, type Interstitial, type InterstitialSettings } from '../../../shared/interstitials';
import { composeFlows } from '../call-response/compose';
import { interactionFor, sceneFrames, type CallResponseFlow, type TimelineScene } from '../call-response/model';
import { projectFlows, type Project } from '../project/types';
import { behaviors, conditionsFor, defaultCondition, normalizeConditions, outputOffset } from './behaviors';
import { storyGenerationItem } from './referenceInputs';
import type { ClipColor } from './clipColors';

export type NodeKind = 'source' | 'simple' | 'looped' | 'conditional';
export type StoryCondition = { id: string; label: string; values: string[] };
export type StoryNode = {
  id: string; name: string; kind: NodeKind; x: number; y: number;
  color?: ClipColor;
  source?: { kind?: 'image'; assetId: string; originalAssetId?:string; duration?:number; inFrame: number; outFrame: number };
  /** Edit range relative to the generated body, leaving the cached output intact. */
  trim?: { inFrame: number; outFrame: number };
  interstitialId?: string;
  referenceId?: string;
  /** Read only for older graph files; new fades belong to connections. */
  crossfadeStart?: number; crossfadeEnd?: number;
  /** Zero waits for Continue; positive counts complete iterations. */
  loopCount: number;
  /** Independent repeat overlaps in seconds; zero makes a hard cut for that channel. */
  loopVideoCrossfade?: number; loopAudioCrossfade?: number;
  loop?: boolean; conditional?: boolean; conditions?: StoryCondition[]; defaultConditionId?: string;
};
export type FadeChannel = 'video' | 'audio';
export type StoryEdge = { id: string; from: string; to: string; event: 'next' | 'answer' | 'fallback'; conditionId?: string; label: string; values: string[];
  /** Shared defaults from older projects; individual edits override only their channel. */
  crossfade?: number; crossfadeReferenceRatio?: number; videoCrossfade?: number; audioCrossfade?: number;
  points?: {id:string;x:number;y:number}[] };
export const groupColors = { blue: '#82a5bd', purple: '#a391c2', green: '#80a69a', amber: '#c4a779', rose: '#c58d99' } as const;
export type GroupBounds = { x: number; y: number; width: number; height: number };
export type StoryGroup = { id: string; name: string; nodeIds: string[]; color: keyof typeof groupColors; bounds?: GroupBounds };
export type StoryTemplate = { id: string; name: string; entryId: string; nodes: StoryNode[]; edges: StoryEdge[]; settings: Record<string, InterstitialSettings>; color?: StoryGroup['color'] };
export type StoryGraph = { version: 1; entryId: string; nodes: StoryNode[]; edges: StoryEdge[]; templates: StoryTemplate[]; groups?: StoryGroup[] };
export const PIXELS_PER_SECOND = 32;
export const CLIP_HEIGHT = 76;
/** Conditional sockets and labels remain fixed-size and can extend beyond the clip. */
export function nodeVisualBounds(graph: Pick<StoryGraph, 'edges'>, node: StoryNode) {
  const count = behaviors(node).conditional ? conditionsFor(graph, node).length : 0;
  return { topOffset: count ? Math.min(0, outputOffset(count, 0) - 10) : 0,
    bottomOffset: count ? Math.max(CLIP_HEIGHT, outputOffset(count, count - 1) + 10) : CLIP_HEIGHT,
    rightOverflow: count ? 110 : 0 };
}
export const freshId = (): string => crypto.randomUUID();
export const edge = (from: string, to: string, event: StoryEdge['event'] = 'next', label = 'Next'): StoryEdge => ({ id: freshId(), from, to, event, label, values: [] });
/** New interstitial attachments follow their references until explicitly edited. */
export function withReferenceFade(connection: StoryEdge, nodes: StoryNode[]): StoryEdge {
  if (connection.from === connection.to || !nodes.some(n => n.interstitialId && (n.id === connection.from || n.id === connection.to))) return connection;
  return { ...connection, crossfade: undefined, crossfadeReferenceRatio: .75, videoCrossfade: undefined, audioCrossfade: undefined };
}
function referenceFadeLength(node: StoryNode | undefined, neighbor: StoryNode | undefined, items: Interstitial[], side: 'before' | 'after'): number | undefined {
  const item = items.find(item => item.id === node?.interstitialId);
  if (!node || !item) return;
  const result = playableResult(item);
  if (result) {
    // Follow the video being played, even while different settings are queued for regeneration.
    return nodeMediaLayout(node, items)[side] || undefined;
  }
  const settings = storyGenerationItem(item, node);
  if (side === 'after' && settings.method === 'comfy-loop') return;
  if (!(side === 'before' ? settings.useInputReference : settings.useOutputReference)) return;
  const length = side === 'before' ? settings.start_range : settings.end_range;
  return Math.max(0, Math.min(length, neighbor ? nodeDuration(neighbor, items) : 0));
}
export function connectionFade(connection: StoryEdge, nodes: StoryNode[], items: Interstitial[] = [], channel: FadeChannel = 'video') {
  const override = connection[`${channel}Crossfade`];
  if (override !== undefined) return override;
  if (connection.crossfade !== undefined) return connection.crossfade;
  const before = nodes.find(n => n.id === connection.from), after = nodes.find(n => n.id === connection.to);
  if (connection.crossfadeReferenceRatio !== undefined) {
    if (connection.from === connection.to) return 0;
    // Playback prefers the destination's opening reference, then the source's ending reference.
    const length = referenceFadeLength(after, before, items, 'before') ?? referenceFadeLength(before, after, items, 'after') ?? 0;
    return Math.round(length * connection.crossfadeReferenceRatio * TIMELINE_FPS) / TIMELINE_FPS;
  }
  return after?.interstitialId ? after.crossfadeStart ?? .25 : before?.interstitialId ? before.crossfadeEnd ?? .25
    : Math.max(before?.crossfadeEnd ?? 0, after?.crossfadeStart ?? 0);
}
export function migrateFades(graph: StoryGraph): StoryGraph {
  graph=normalizeConditions({...graph,templates:graph.templates.map(normalizeConditions)});
  const migrate = (e: StoryEdge, nodes: StoryNode[]) => e.crossfadeReferenceRatio !== undefined ? e
    : { ...e, crossfade: e.crossfade ?? connectionFade({ ...e, videoCrossfade: undefined }, nodes) };
  return { ...graph, edges: graph.edges.map(e => migrate(e, graph.nodes)),
    nodes: graph.nodes.map(({crossfadeStart, crossfadeEnd, ...node}) => node),
    templates: graph.templates.map(t => ({ ...t, edges: t.edges.map(e => migrate(e, t.nodes)),
      nodes:t.nodes.map(({crossfadeStart,crossfadeEnd,...node})=>node) })) };
}
export function nodeDuration(node: StoryNode, items: Interstitial[]): number {
  if (node.source) return (node.source.outFrame - node.source.inFrame) / TIMELINE_FPS;
  const item = items.find(item => item.id === node.interstitialId);
  const duration=item && playableResult(item)?.duration || item?.duration || 6;
  if(!node.trim)return duration;
  const bounds=generatedBounds(node,duration);return (bounds.outFrame-bounds.inFrame)/TIMELINE_FPS;
}
export function generatedBounds(node:StoryNode,duration:number){
  const total=Math.max(1,Math.round(duration*TIMELINE_FPS)),start=Math.min(total-1,node.trim?.inFrame??0);
  return {inFrame:start,outFrame:Math.max(start+1,Math.min(total,node.trim?.outFrame??total))};
}
/** Reference handles sit outside the playable body and share its time scale. */
export function nodeMediaLayout(node:StoryNode,items:Interstitial[]) {
  const item=items.find(i=>i.id===node.interstitialId),result=item&&playableResult(item),body=nodeDuration(node,items);
  const range=result?.fullAssetId?result.fullRange??(result===item?.result?item.requestInsertion:undefined):result;
  const bounds=generatedBounds(node,result?.duration??body);
  const before=range&&bounds.inFrame===0?Math.max(0,range.start):0;
  const after=range&&bounds.outFrame===Math.round(result!.duration*TIMELINE_FPS)?Math.max(0,range.totalDuration-range.start-range.duration):0;
  return {before,body,after,total:before+body+after};
}
export function reachableNodes(graph: StoryGraph) {
  const visited = new Set<string>(), pending = [graph.entryId];
  while (pending.length) { const id = pending.pop()!; if (visited.has(id)) continue; visited.add(id); pending.push(...graph.edges.filter(e => e.from === id).map(e => e.to)); }
  return visited;
}
type LayoutRect = {left:number;right:number;top:number;bottom:number};
const overlaps=(a:LayoutRect,b:LayoutRect)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
// Distances use visible clip edges in canvas units (pixels at 100% zoom).
const MAX_LOOSE_GAP = 600, LOOSE_GAP = 104;
/** Find the closest free position, leaving a little room around a displaced clip. */
function nearestFreePosition(rect:LayoutRect,occupied:LayoutRect[]) {
  const padding=24,width=rect.right-rect.left,height=rect.bottom-rect.top;
  const columns=[rect.left,...occupied.flatMap(r=>[r.left-width-padding,r.right+padding])];
  const rows=[...occupied].sort((a,b)=>a.top-b.top);
  let best={x:rect.left,y:rect.top},distance=Infinity;
  // The closest point outside the forbidden rectangles lies on an obstacle's
  // boundary, or shares the original x. Merge blocked y intervals at each x.
  for(const x of columns){
    const dx=(x-rect.left)**2;if(dx>=distance)continue;
    const intervals:{start:number;end:number}[]=[];
    for(const r of rows){
      if(x>=r.right+padding||x+width<=r.left-padding)continue;
      const start=r.top-height-padding,end=r.bottom+padding,last=intervals.at(-1);
      if(last&&start<last.end)last.end=Math.max(last.end,end);
      else intervals.push({start,end});
    }
    const blocked=intervals.find(r=>r.start<rect.top&&rect.top<r.end);
    const y=blocked?(rect.top-blocked.start<blocked.end-rect.top?blocked.start:blocked.end):rect.top;
    const next=dx+(y-rect.top)**2;
    if(next<distance){best={x,y};distance=next;}
  }
  return best;
}
export function autoLayout(graph: StoryGraph, items: Interstitial[], viewportHeight=360): StoryGraph {
  if(!graph.nodes.length)return graph;
  const grouped=graph.groups?.some(g=>g.nodeIds.length),padding=24,gap=grouped?160:LOOSE_GAP;
  // Connected paths can share a column; branches retain their vertical rows.
  // Loose clips do not participate in packing.
  const columnHeight=Math.max(CLIP_HEIGHT,viewportHeight-(grouped?100:64));
  const byId=new Map(graph.nodes.map(n=>[n.id,n])),media=new Map(graph.nodes.map(n=>[n.id,nodeMediaLayout(n,items)]));
  const visuals=new Map(graph.nodes.map(n=>[n.id,nodeVisualBounds(graph,n)]));
  const neighbors=new Map(graph.nodes.map(n=>[n.id,new Set<string>()])),outgoing=new Map(graph.nodes.map(n=>[n.id,[] as string[]]));
  const incoming=new Set<string>(),linked=new Set<string>();
  const join=(a:string,b:string)=>{if(a!==b&&byId.has(a)&&byId.has(b)){neighbors.get(a)!.add(b);neighbors.get(b)!.add(a);}};
  for(const edge of graph.edges){
    if(edge.from===edge.to||!byId.has(edge.from)||!byId.has(edge.to))continue;
    join(edge.from,edge.to);outgoing.get(edge.from)!.push(edge.to);incoming.add(edge.to);linked.add(edge.from);linked.add(edge.to);
  }
  // The entry clip anchors compositions without connections as well, so moving
  // an entire arrangement far from the origin does not strand its loose clips.
  const layoutIds=new Set(linked);
  if(byId.has(graph.entryId))layoutIds.add(graph.entryId);
  if(!layoutIds.size)layoutIds.add(graph.nodes[0].id);
  // Keep the connected paths in each group together. Group membership alone
  // does not opt a loose clip into rearrangement.
  for(const group of graph.groups??[]){const members=group.nodeIds.filter(id=>layoutIds.has(id));for(const id of members.slice(1))join(members[0],id);}
  const order=[...new Set([graph.entryId,...byId.keys()])].filter(id=>layoutIds.has(id)),seen=new Set<string>();
  const left=(id:string)=>byId.get(id)!.x-media.get(id)!.before*PIXELS_PER_SECOND;
  const components:{ids:string[];left:number;top:number}[]=[];
  for(const root of order){
    if(seen.has(root))continue;
    // Use both directions so two inputs sharing a downstream clip stay together.
    const component=new Set<string>(),pending=[root];
    for(let i=0;i<pending.length;i++){
      const id=pending[i];if(component.has(id))continue;
      component.add(id);seen.add(id);pending.push(...neighbors.get(id)!);
    }
    const ids=order.filter(id=>component.has(id));
    components.push({ids,left:Math.min(...ids.map(left)),top:Math.min(...ids.map(id=>byId.get(id)!.y))});
  }
  // Use each block's visible position, not creation order or playback entry.
  // Equal positions retain the original traversal order for new/legacy graphs.
  components.sort((a,b)=>a.left-b.left||a.top-b.top);
  const positioned=new Map<string,StoryNode>();let columnX=40,columnWidth=0,usedHeight=0;
  for(const component of components){
    const ids=component.ids,levels=new Map<string,number>();
    const queue:[string,number][]=ids.filter(id=>!incoming.has(id)||id===graph.entryId).map(id=>[id,0]);
    const visit=()=>{for(let i=0;i<queue.length;i++){
      const [id,depth]=queue[i];if(levels.has(id))continue;
      levels.set(id,depth);for(const next of outgoing.get(id)!)queue.push([next,depth+1]);
    }queue.length=0;};
    visit();
    // Cycles and disconnected cycles inside a group have no incoming-free root.
    for(const id of ids)if(!levels.has(id)){queue.push([id,0]);visit();}
    const columns=Array.from({length:Math.max(...levels.values())+1},(_,depth)=>ids.filter(id=>levels.get(id)===depth)
      .sort((a,b)=>byId.get(a)!.y-byId.get(b)!.y||left(a)-left(b)));
    const local=new Map<string,{x:number;y:number}>();let width=0;
    for(const [columnIndex,column] of columns.entries()){
      // Pack each neighboring pair by its own visible bounds. A tall condition
      // list in another column must not spread every destination farther apart.
      let y=0;
      for(const [index,id] of column.entries()){
        if(index)y+=visuals.get(column[index-1])!.bottomOffset-visuals.get(id)!.topOffset+padding;
        local.set(id,{x:width+media.get(id)!.before*PIXELS_PER_SECOND,y});
      }
      for(const id of column)local.get(id)!.y-=y/2;
      const bodyWidth=Math.max(...column.map(id=>media.get(id)!.total*PIXELS_PER_SECOND));
      const visibleWidth=Math.max(...column.map(id=>media.get(id)!.total*PIXELS_PER_SECOND+visuals.get(id)!.rightOverflow));
      // Existing wire spacing already accommodates most labels; only reserve
      // additional width when a label would actually run into the next column.
      width+=columnIndex===columns.length-1?visibleWidth:Math.max(bodyWidth+gap,visibleWidth+padding);
    }
    const top=Math.min(...ids.map(id=>local.get(id)!.y+visuals.get(id)!.topOffset));
    const height=Math.max(...ids.map(id=>local.get(id)!.y+visuals.get(id)!.bottomOffset))-top;
    if(usedHeight&&usedHeight+height>columnHeight){columnX+=columnWidth+gap;columnWidth=0;usedHeight=0;}
    for(const id of ids){const p=local.get(id)!;positioned.set(id,{...byId.get(id)!,x:columnX+p.x,y:90+usedHeight+p.y-top});}
    columnWidth=Math.max(columnWidth,width);usedHeight+=height+(grouped?104:padding);
  }
  const rectangle=(n:StoryNode):LayoutRect=>({left:n.x-media.get(n.id)!.before*PIXELS_PER_SECOND,
    right:n.x+(media.get(n.id)!.body+media.get(n.id)!.after)*PIXELS_PER_SECOND+visuals.get(n.id)!.rightOverflow,
    top:n.y+visuals.get(n.id)!.topOffset,bottom:n.y+visuals.get(n.id)!.bottomOffset});
  const anchors=order.map(id=>({before:byId.get(id)!,after:positioned.get(id)!,rect:rectangle(byId.get(id)!)}));
  const occupied=[...positioned.values()].map(rectangle),displaced:StoryNode[]=[];
  // Follow the nearest clip in the original layout, using visible media bounds
  // so a long clip's nearby end counts. Bring distant outliers back alongside
  // that anchor, then resolve overlaps without displacing nearby loose clips.
  const loose=graph.nodes.filter(n=>!layoutIds.has(n.id)).map(node=>{
    const rect=rectangle(node);
    let nearest=anchors[0],distance=Infinity,centerDistance=Infinity;
    for(const anchor of anchors){
      const r=anchor.rect;
      const gap=Math.max(rect.left-r.right,r.left-rect.right,0)**2+Math.max(rect.top-r.bottom,r.top-rect.bottom,0)**2;
      const center=(rect.left+rect.right-r.left-r.right)**2+(rect.top+rect.bottom-r.top-r.bottom)**2;
      if(gap<distance||gap===distance&&center<centerDistance){nearest=anchor;distance=gap;centerDistance=center;}
    }
    const next={...node,x:node.x+(nearest.after.x-nearest.before.x),y:node.y+(nearest.after.y-nearest.before.y)};
    const distant=distance>MAX_LOOSE_GAP**2;
    if(distant){
      const r=nearest.rect;
      const dx=rect.left>r.right?rect.left-r.right:rect.right<r.left?rect.right-r.left:0;
      const dy=rect.top>r.bottom?rect.top-r.bottom:rect.bottom<r.top?rect.bottom-r.top:0;
      const scale=1-LOOSE_GAP/Math.sqrt(distance);
      next.x-=dx*scale;next.y-=dy*scale;
    }
    return {node:next,distant};
  });
  // Reserve clear preferred positions first, so resolving one collision does
  // not push another clip away from its existing neighbors.
  for(const {node,distant} of loose){
    const rect=rectangle(node);
    if(distant||occupied.some(other=>overlaps(rect,other)))displaced.push(node);
    else {positioned.set(node.id,node);occupied.push(rect);}
  }
  for(const node of displaced){
    const rect=rectangle(node),point=nearestFreePosition(rect,occupied);
    const next={...node,x:node.x+(point.x-rect.left),y:node.y+(point.y-rect.top)};
    positioned.set(node.id,next);occupied.push(rectangle(next));
  }
  const moved=new Set(graph.nodes.filter(n=>{const p=positioned.get(n.id)!;return n.x!==p.x||n.y!==p.y;}).map(n=>n.id));
  const groups=graph.groups?.map(group=>{
    if(!group.bounds||!group.nodeIds.some(id=>moved.has(id)))return group;
    const shifts=group.nodeIds.filter(id=>byId.has(id)).map(id=>({x:positioned.get(id)!.x-byId.get(id)!.x,y:positioned.get(id)!.y-byId.get(id)!.y})),shift=shifts[0];
    return {...group,bounds:shifts.every(p=>p.x===shift.x&&p.y===shift.y)
      ?{...group.bounds,x:group.bounds.x+shift.x,y:group.bounds.y+shift.y}:undefined};
  });
  return {...graph,nodes:graph.nodes.map(n=>positioned.get(n.id)!),edges:graph.edges.map(e=>{
    if(!e.points?.length)return e;
    if(linked.has(e.from)&&linked.has(e.to))return {...e,points:undefined};
    if(e.from!==e.to||!moved.has(e.from))return e;
    const before=byId.get(e.from)!,after=positioned.get(e.from)!;
    return {...e,points:e.points.map(p=>({...p,x:p.x+after.x-before.x,y:p.y+after.y-before.y}))};
  }),groups:groups?.some((g,i)=>g!==graph.groups![i])?groups:graph.groups};
}
export function createNode(kind: Exclude<NodeKind, 'source'>, referenceId?: string): { node: StoryNode; item: Interstitial } {
  const id = freshId(), itemId = freshId();
  const name = kind === 'simple' ? 'New scene' : kind === 'looped' ? 'Waiting loop' : 'Choose a path';
  return { node: { id, name, kind, loop:kind==='looped',conditional:kind==='conditional',interstitialId: itemId, referenceId, x: 40, y: 90, loopCount: 0 },
    item: { id: itemId, label: name, kind: 'regular', time: 0, phase: 'draft', method: kind === 'simple' ? 'comfy-extend' : 'comfy-loop',
      duration: kind === 'simple' ? 6 : 4, start_range: 2, end_range: 2, prompt: '', enable_prompt_expansion: false } };
}
/** Legacy interaction sections become ordinary editable frames around their generated clips. */
function legacyGroups(project:Project,nodes:StoryNode[]):StoryGroup[] {
  const flows=projectFlows(project),ids=[...new Set([...flows.map(f=>f.interstitial.id),...project.interstitials.flatMap(i=>i.groupId?[i.groupId]:[])])];
  return ids.flatMap((id,index)=>{
    const flow=flows.find(f=>f.interstitial.id===id),items=new Set([...project.interstitials.filter(i=>i.groupId===id).map(i=>i.id),...(flow?.scenes.flatMap(s=>s.interstitialId?[s.interstitialId]:[])??[])]);
    const nodeIds=nodes.filter(n=>n.interstitialId&&items.has(n.interstitialId)).map(n=>n.id),label=flow?.interstitial.label??project.interstitials.find(i=>i.id===id)?.label;
    return nodeIds.length?[{id:freshId(),name:label&&label!=='Untitled'?label.slice(0,200):`Question & response ${index+1}`,nodeIds,color:index%2?'purple' as const:'blue' as const}]:[];
  });
}
/** Upgrade the visible legacy composition once, preserving media and editable interaction groups. */
export function migrateGraph(project: Project, duration: number): StoryGraph {
  if (project.storyFlow) {
    const graph=project.storyFlow,legacyFade=(project.crossfadeFrames??14)/TIMELINE_FPS;
    // Early graph migration halved the example's saved fade; restore untouched legacy joins.
    const edges=graph.edges.map(e=>e.crossfade===undefined&&e.crossfadeReferenceRatio===undefined&&connectionFade(e,graph.nodes)===legacyFade/2&&
      graph.nodes.some(n=>(n.id===e.from||n.id===e.to)&&project.interstitials.some(i=>i.id===n.interstitialId&&i.groupId))?{...e,crossfade:legacyFade}:e);
    const groups=graph.groups??legacyGroups(project,graph.nodes);
    return migrateFades({...graph,edges,...(groups.length||graph.groups?{groups}:{})});
  }
  const assetId = project.source.assetId!, flows = projectFlows(project);
  const composed = flows.length ? composeFlows(flows, project.interstitials, assetId, duration) : undefined;
  let graph: StoryGraph = { version: 1, entryId: '', nodes: [], edges: [], templates: [] };
  const fade = (project.crossfadeFrames ?? 14) / TIMELINE_FPS;
  if (composed) {
    graph.entryId = composed.entrySceneId;
    graph.nodes = composed.scenes.map(scene => ({ id: scene.id, name: scene.label,
      kind: scene.interstitialId ? scene.clip.kind === 'idle' ? 'conditional' : 'simple' : 'source',
      source: scene.interstitialId ? undefined : { assetId: scene.clip.assetId, inFrame: scene.clip.inFrame, outFrame: scene.clip.outFrame },
      interstitialId: scene.interstitialId, referenceId: composed.edges.find(e => e.to === scene.id && e.from !== e.to)?.from,
      x: 0, y: 0, crossfadeStart: scene.interstitialId ? fade : 0, crossfadeEnd: scene.interstitialId ? fade : 0, loopCount: 0 }));
    graph.edges = composed.edges.map(e => ({ id: e.id, from: e.from, to: e.to,
      event: e.when === 'ended' ? 'next' : e.when === 'pending' ? 'fallback' : 'answer',
      label: e.label, values: interactionFor(composed, e.from)?.answers.find(a => a.id === e.when)?.values ?? [] }));
    graph.groups=legacyGroups(project,graph.nodes);
  } else {
    const items = project.interstitials.filter(i => i.kind !== 'call-response' && !i.groupId).slice().sort((a,b) => a.time-b.time);
    let cursor = 0, previous: string | undefined;
    const append = (node: StoryNode) => { if (previous) graph.edges.push(edge(previous, node.id)); else graph.entryId = node.id; graph.nodes.push(node); previous = node.id; };
    const total = Math.max(1, Math.floor(duration * TIMELINE_FPS));
    for (let index = 0; index <= items.length; index++) {
      const item = items[index], end = item ? Math.min(total, Math.round(item.time * TIMELINE_FPS)) : total;
      if (end > cursor) append({ id: freshId(), name: items.length ? `Source ${index + 1}` : project.source.name, kind: 'source', source: { assetId, inFrame: cursor, outFrame: end }, x:0, y:0, crossfadeStart:0, crossfadeEnd:0, loopCount:0 });
      if (item) append({ id:freshId(), name:item.label, kind:item.method === 'comfy-loop' ? 'looped':'simple', interstitialId:item.id, referenceId:previous, x:0,y:0,crossfadeStart:fade,crossfadeEnd:fade,loopCount:0 });
      cursor = end;
    }
  }
  return autoLayout(migrateFades(graph), project.interstitials);
}
/** Adapt the general graph to the existing media decks. No template or parent controls playback. */
export function runtimeFlow(graph: StoryGraph, items: Interstitial[], sourceAssetId: string, duration: number): CallResponseFlow {
  graph=normalizeConditions(graph);
  const fps = TIMELINE_FPS, total = Math.max(1, Math.floor(duration * fps));
  const scenes: TimelineScene[] = graph.nodes.map(node => {
    const item = items.find(i => i.id === node.interstitialId), saved = item && playableResult(item);
    const result = saved?.fullAssetId && !saved.fullRange && saved === item?.result && item.requestInsertion
      ? {...saved, fullRange:item.requestInsertion} : saved;
    const bounds=generatedBounds(node,result?.duration??item?.duration??6),start=result?Math.round(result.start*fps):0;
    const source = node.source ?? { assetId: result?.assetId ?? sourceAssetId, inFrame: result ? start+bounds.inFrame : 0, outFrame: result ? start+bounds.outFrame : 1 };
    return { id:node.id, label:item?.label ?? node.name, role:node.kind === 'source' ? 'source':'call', dialogue:item?.dialogue ?? '', interstitialId:node.interstitialId,
      draft:!node.source && !result, plannedFrames:bounds.outFrame-bounds.inFrame, generated:result,
      sourceTime:item?.time, storyNode:node,
      clip:behaviors(node).loop || behaviors(node).conditional ? { id:node.id, ...source, kind:'idle', repeat:'until-answer',exitAt:'loop-boundary' } : { id:node.id,...source,kind:node.kind === 'source' ? 'video':'call' } };
  });
  // Drafts hold a reference frame, following the generation dependency rather than a fixed role name.
  const resolveDraft = (scene: TimelineScene, seen = new Set<string>()) => {
    if (!scene.draft || seen.has(scene.id)) return; seen.add(scene.id);
    const before = scenes.find(s => s.id === graph.edges.find(e => e.to === scene.id && e.from !== scene.id)?.from);
    if (before) { resolveDraft(before, seen); scene.clip = { ...scene.clip, assetId:before.clip.assetId,inFrame:Math.max(0,before.clip.outFrame-1),outFrame:before.clip.outFrame }; }
    else scene.clip = { ...scene.clip,assetId:sourceAssetId,inFrame:0,outFrame:Math.min(1,total) };
  };
  scenes.forEach(s => resolveDraft(s));
  const fadeFrames = (e: StoryEdge) => ({ transitionFrames: Math.round(connectionFade(e, graph.nodes, items, 'video') * fps),
    audioTransitionFrames: Math.round(connectionFade(e, graph.nodes, items, 'audio') * fps) });
  const edges: CallResponseFlow['edges'] = graph.edges.map(e => ({ ...e, when:e.event === 'answer' ? e.id : e.event === 'fallback' ? 'pending' : 'ended', ...fadeFrames(e) }));
  const interactions: NonNullable<CallResponseFlow['storyInteractions']> = {};
  for (const node of graph.nodes) {
    const behavior=behaviors(node);
    if (behavior.conditional) interactions[node.id] = { question:node.name,waitSceneId:node.id,fallbackAnswerId:graph.edges.find(e=>e.from===node.id&&e.event==='answer'&&(e.conditionId??e.id)===defaultCondition(graph,node)?.id)?.id??null,
      answers:conditionsFor(graph,node).flatMap(c=>{const e=graph.edges.find(e=>e.from===node.id&&e.event==='answer'&&(e.conditionId??e.id)===c.id);return e?[{id:e.id,label:c.label,values:c.values,sceneId:e.to}]:[]}) };
    else if (behavior.loop) {
      const next = graph.edges.find(e => e.from === node.id && e.event === 'next');
      if (next) edges.push({ id:`${node.id}:exit`,from:node.id,to:next.to,when:`${node.id}:continue`,label:'Continue',...fadeFrames(next) });
      interactions[node.id] = { question:'',waitSceneId:node.id,fallbackAnswerId:null,answers:next ? [{id:`${node.id}:continue`,label:'Continue',values:['continue'],sceneId:next.to}] : [] };
    }
    if(behavior.loop) edges.push({id:`${node.id}:repeat`,from:node.id,to:node.id,when:'repeat',label:'Repeat',transitionFrames:0});
  }
  const starts: Record<string,number> = {}; let cursor = 0;
  // Transport coordinates are local ordering only; canvas coordinates never influence playback.
  const order:string[] = [], visited=new Set<string>();
  const visit=(id:string)=>{if(visited.has(id))return;visited.add(id);order.push(id);graph.edges.filter(e=>e.from===id && e.to!==id).forEach(e=>visit(e.to));};
  if(graph.nodes.length)visit(graph.entryId); graph.nodes.forEach(n=>visit(n.id));
  order.forEach(id=>{const scene=scenes.find(s=>s.id===id)!;starts[id]=cursor;cursor+=sceneFrames(scene);});
  return {version:2,storyGraph:true,storyInteractions:interactions, fps, entrySceneId:graph.entryId,scenes,edges,
    interstitial:{id:'story',kind:'call-response',label:'Story flow',time:0,clipIds:[],linkResponseDurations:false},
    interaction:{question:'',waitSceneId:'',fallbackAnswerId:null,answers:Object.values(interactions).flatMap(i=>i.answers)},
    layout:{starts,totalFrames:cursor},seekPath:order};
}

export function connect(graph: StoryGraph, from: string, to: string, edgeId?: string, conditionId?: string): StoryGraph {
  const node=graph.nodes.find(n=>n.id===from); if(!node || !graph.nodes.some(n=>n.id===to)) return graph;
  if(edgeId) return {...graph,edges:graph.edges.map(e=>{
    if(e.id!==edgeId)return e;
    const rewired={...e,to};
    // Keep an interstitial connection's manual fade when redirecting it. A former
    // source-to-source cut gains a reference fade when first attached to an interstitial.
    return graph.nodes.some(n=>n.interstitialId&&(n.id===e.from||n.id===e.to))?rewired:withReferenceFade(rewired,graph.nodes);
  }),nodes:graph.nodes.map(n=>n.id===to&&!n.referenceId&&from!==to?{...n,referenceId:from}:n)};
  const conditional=behaviors(node).conditional,conditions=conditionsFor(graph,node);
  const condition=conditional?(conditions.find(c=>c.id===conditionId)??(!conditionId?{id:freshId(),label:`Condition ${conditions.length+1}`,values:[]}:undefined)):undefined;
  if(conditional&&!condition)return graph;
  const event=conditional?'answer':'next';
  const added=withReferenceFade({...edge(from,to,event,condition?.label??'Next'),conditionId:condition?.id,values:condition?.values??[]},graph.nodes);
  return {...graph,edges:[...graph.edges.filter(e=>e.from!==from||(event==='answer'?(e.conditionId??e.id)!==condition?.id:e.event!==event)),added],
    nodes:graph.nodes.map(n=>n.id===from&&condition?{...n,conditions:conditions.some(c=>c.id===condition.id)?conditions:[...conditions,condition]}:n.id===to&&!n.referenceId&&from!==to?{...n,referenceId:from}:n)};
}
export function removeNodes(graph: StoryGraph, ids: string[]): StoryGraph {
  const removed=new Set(ids), nodes=graph.nodes.filter(n=>!removed.has(n.id));
  return {...graph,entryId:removed.has(graph.entryId)?nodes[0]?.id??'':graph.entryId,nodes:nodes.map(n=>removed.has(n.referenceId??'')?{...n,referenceId:undefined}:n),edges:graph.edges.filter(e=>!removed.has(e.from)&&!removed.has(e.to)),
    groups:graph.groups?.map(g=>({...g,nodeIds:g.nodeIds.filter(id=>!removed.has(id))})).filter(g=>g.nodeIds.length||g.bounds)};
}
export function splitSource(graph: StoryGraph, id: string, frame: number): StoryGraph {
  const node=graph.nodes.find(n=>n.id===id); if(!node?.source || frame<=0 || frame>=node.source.outFrame-node.source.inFrame)return graph;
  const right={...node,id:freshId(),name:`${node.name} (continued)`,source:{...node.source,inFrame:node.source.inFrame+frame},x:node.x+frame/TIMELINE_FPS*PIXELS_PER_SECOND+104,crossfadeStart:0};
  return {...graph,nodes:[...graph.nodes.map(n=>n.id===id?{...n,loop:false,conditional:false,conditions:[],defaultConditionId:undefined,source:{...n.source!,outFrame:n.source!.inFrame+frame},crossfadeEnd:0}:n.referenceId===id?{...n,referenceId:right.id}:n),right],
    groups:graph.groups?.map(g=>g.nodeIds.includes(id)?{...g,nodeIds:[...g.nodeIds,right.id]}:g),
    edges:[...graph.edges.map(e=>e.from===id?{...e,from:right.id,to:e.to===id?right.id:e.to}:e),{...edge(id,right.id),crossfade:0}]};
}
export function splitClip(graph:StoryGraph,items:Interstitial[],id:string,frame:number):{graph:StoryGraph;items:Interstitial[];rightId?:string}{
  const node=graph.nodes.find(n=>n.id===id),cut=Math.round(frame);
  if(!node||cut<=0||cut>=Math.round(nodeDuration(node,items)*TIMELINE_FPS))return {graph,items:[]};
  if(node.source){const next=splitSource(graph,id,cut);return {graph:next,items:[],rightId:next.nodes.at(-1)!.id};}
  const item=items.find(i=>i.id===node.interstitialId);if(!item)return {graph,items:[]};
  const result=playableResult(item),bounds=generatedBounds(node,result?.duration??item.duration),itemId=freshId();
  const right={...node,id:freshId(),name:`${node.name} (continued)`,interstitialId:itemId,trim:{inFrame:bounds.inFrame+cut,outFrame:bounds.outFrame},x:node.x+cut/TIMELINE_FPS*PIXELS_PER_SECOND+104,crossfadeStart:0};
  const added:Interstitial={...item,id:itemId,label:right.name,kind:'regular',groupId:undefined,phase:result?'ready':'draft',result,requestPrompt:result?.prompt??(item.phase==='ready'?item.requestPrompt:undefined),previousResult:undefined,requestId:undefined,error:undefined};
  return {graph:{...graph,nodes:[...graph.nodes.map(n=>n.id===id?{...n,kind:'simple' as const,loop:false,conditional:false,conditions:[],defaultConditionId:undefined,trim:{inFrame:bounds.inFrame,outFrame:bounds.inFrame+cut},crossfadeEnd:0}:n.referenceId===id?{...n,referenceId:right.id}:n),right],
    groups:graph.groups?.map(g=>g.nodeIds.includes(id)?{...g,nodeIds:[...g.nodeIds,right.id]}:g),
    edges:[...graph.edges.map(e=>e.from===id?{...e,from:right.id,to:e.to===id?right.id:e.to}:e),{...edge(id,right.id),crossfade:0}]},items:[added],rightId:right.id};
}
