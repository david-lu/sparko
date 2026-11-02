import type { Interstitial } from '../../../shared/interstitials';
import { CLIP_HEIGHT, PIXELS_PER_SECOND, freshId, nodeMediaLayout, type GroupBounds, type StoryGraph, type StoryGroup } from './model';
import { toScreen, type Camera } from './viewport';

/** Frame the clips; connection labels and wire bends can extend outside the group. */
export function groupFrame(graph: StoryGraph, group: StoryGroup, items: Interstitial[], camera: Camera) {
  const members = graph.nodes.filter(n => group.nodeIds.includes(n.id));
  const clips = members.map(n => {
    const layout = nodeMediaLayout(n, items), p = toScreen({x:n.x-layout.before*PIXELS_PER_SECOND,y:n.y}, camera);
    return {left:p.x,right:p.x+layout.total*PIXELS_PER_SECOND*camera.zoom,top:p.y,bottom:p.y+CLIP_HEIGHT};
  });
  const content = clips.length ? {left:Math.min(...clips.map(c=>c.left))-18,
    right:Math.max(...clips.map(c=>c.right))+18,
    top:Math.min(...clips.map(c=>c.top))-38,
    bottom:Math.max(...clips.map(c=>c.bottom))+28} : undefined;
  const b=group.bounds, p=b&&toScreen(b,camera),frame=b&&p?{left:p.x,top:p.y,right:p.x+b.width*camera.zoom,bottom:p.y+b.height*camera.rowScale}:content;
  if(!frame)return;
  const left=Math.min(frame.left,content?.left??Infinity),top=Math.min(frame.top,content?.top??Infinity);
  return {left,top,width:Math.max(frame.right,content?.right??-Infinity)-left,height:Math.max(frame.bottom,content?.bottom??-Infinity)-top};
}

/** Membership is explicit, so a nearby clip never accidentally moves with a group. */
export function groupClips(graph: StoryGraph, ids: string[], name: string, color: StoryGroup['color'] = 'blue', bounds?: GroupBounds) {
  const selected = new Set(ids), nodeIds = graph.nodes.filter(n => selected.has(n.id)).map(n => n.id);
  if ((!nodeIds.length&&!bounds)||(graph.groups?.length??0)>=1000) return { graph, group: undefined };
  const group: StoryGroup = { id: freshId(), name: name.trim().slice(0, 200) || 'Group', nodeIds, color, ...(bounds?{bounds}:{}) };
  const groups = (graph.groups ?? []).map(g => ({ ...g, nodeIds: g.nodeIds.filter(id => !selected.has(id)) })).filter(g => g.nodeIds.length||g.bounds);
  return { graph: { ...graph, groups: [...groups, group] }, group };
}

/** Explicit membership changes preserve footage, routing, and the last member's frame. */
export function setGroupMembers(graph: StoryGraph, groupId: string, ids: string[], items: Interstitial[]): StoryGraph {
  const group=graph.groups?.find(g=>g.id===groupId);if(!group)return graph;
  const nodeIds=graph.nodes.filter(n=>ids.includes(n.id)).map(n=>n.id);
  const frame=groupFrame(graph,group,items,{x:0,y:0,zoom:1,rowScale:1});
  const bounds=group.bounds??(!nodeIds.length&&frame?{x:frame.left,y:frame.top,width:frame.width,height:frame.height}:undefined);
  return {...graph,groups:graph.groups!.map(g=>g.id===groupId?{...g,nodeIds,bounds}:{...g,nodeIds:g.nodeIds.filter(id=>!nodeIds.includes(id))}).filter(g=>g.nodeIds.length||g.bounds)};
}

export function moveGroup(graph: StoryGraph, groupId: string, dx: number, dy: number): StoryGraph {
  const group=graph.groups?.find(g=>g.id===groupId);if(!group)return graph;
  return {...moveClips(graph,group.nodeIds,dx,dy),groups:graph.groups!.map(g=>g.id===groupId&&g.bounds?{...g,bounds:{...g.bounds,x:g.bounds.x+dx,y:g.bounds.y+dy}}:g)};
}

/** Translate internal bends with their clips; external wire anchors follow the sockets. */
export function moveClips(graph: StoryGraph, ids: string[], dx: number, dy: number): StoryGraph {
  const selected = new Set(ids);
  return { ...graph, nodes: graph.nodes.map(n => selected.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n),
    edges: graph.edges.map(e => selected.has(e.from) && selected.has(e.to) ? { ...e, points: e.points?.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })) } : e) };
}

export function copyGroups(graph: StoryGraph, remap: Map<string, string>, dy=0) {
  return (graph.groups ?? []).filter(g => g.nodeIds.length&&g.nodeIds.every(id => remap.has(id))).map(g => ({ ...g, id: freshId(), name: `${g.name} copy`.slice(0,200), nodeIds: g.nodeIds.map(id => remap.get(id)!),bounds:g.bounds?{...g.bounds,y:g.bounds.y+dy}:undefined }));
}
