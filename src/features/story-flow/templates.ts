import { interstitialSettings, type Interstitial } from '../../../shared/interstitials';
import { autoLayout, createNode, edge, freshId, type StoryEdge, type StoryGraph, type StoryTemplate } from './model';

export const builtInTemplates=[{id:'question',name:'Question & response',description:'A question, a waiting choice, and two reactions.'},{id:'loop',name:'Loop until ready',description:'A waiting loop with a Continue exit.'},{id:'scene',name:'Simple scene',description:'One generated clip, ready to connect.'}];
export function makePreset(id:string):StoryTemplate {
  const question=createNode('simple'),wait=createNode(id==='question'?'conditional':'looped'),yes=createNode('simple'),no=createNode('simple');
  if(id==='question'){question.node.name='Ask a question';question.item.prompt='Ask the viewer a question, keeping the scene and character consistent.';}
  wait.node.name='Wait for the viewer';wait.item.prompt='Hold the pose and wait attentively. Create a seamless loop.';
  yes.node.name='Celebrate';yes.item.prompt='Respond warmly and celebrate the viewer’s answer.';
  no.node.name='Encourage';no.item.prompt='Offer a friendly hint and encourage the viewer to try again.';
  const pairs=id==='question'?[question,wait,yes,no]:id==='loop'?[wait]:[question];
  const edges=id==='question'?[edge(question.node.id,wait.node.id),{...edge(wait.node.id,yes.node.id,'answer','Yes'),values:['yes']},{...edge(wait.node.id,no.node.id,'answer','Not yet'),values:['no','not yet']},edge(wait.node.id,wait.node.id,'fallback','Otherwise: repeat')]:[];
  if(id==='question'){wait.node.referenceId=question.node.id;yes.node.referenceId=wait.node.id;no.node.referenceId=wait.node.id;}
  const layout=autoLayout({version:1,entryId:pairs[0].node.id,nodes:pairs.map(p=>p.node),edges,templates:[]},pairs.map(p=>p.item));
  return {id,name:builtInTemplates.find(t=>t.id===id)!.name,entryId:layout.entryId,nodes:layout.nodes,edges,settings:Object.fromEntries(pairs.map(p=>[p.node.id,interstitialSettings(p.item)]))};
}
export function instantiateTemplate(graph:StoryGraph,template:StoryTemplate,items:Interstitial[],connectionId?:string,placement?:{x:number;y:number}) {
  const remap=new Map(template.nodes.map(n=>[n.id,freshId()])), itemIds=new Map(template.nodes.map(n=>[n.id,freshId()]));
  const connection=graph.edges.find(e=>e.id===connectionId);
  const entry=template.nodes.find(n=>n.id===template.entryId)!,offset=placement?{x:placement.x-entry.x,y:placement.y-entry.y}:{x:0,y:0};
  const nodes=template.nodes.map(n=>({...n,x:n.x+offset.x,y:n.y+offset.y,id:remap.get(n.id)!,interstitialId:itemIds.get(n.id)!,referenceId:remap.get(n.referenceId??'')??(n.id===template.entryId?connection?.from:undefined)}));
  const added:Interstitial[]=template.nodes.map(n=>({id:itemIds.get(n.id)!,label:n.name,time:0,kind:'regular',phase:'draft',...template.settings[n.id]}));
  const edges:StoryEdge[]=template.edges.map(e=>({...e,id:freshId(),from:remap.get(e.from)!,to:remap.get(e.to)!,points:e.points?.map(p=>({...p,id:freshId(),x:p.x+offset.x,y:p.y+offset.y}))}));
  if(connection){edges.push({...connection,id:freshId(),to:remap.get(template.entryId)!,points:undefined});
    for(const node of nodes.filter(n=>!edges.some(e=>e.from===n.id&&e.to!==n.id)))edges.push(edge(node.id,connection.to));}
  const next={...graph,nodes:[...graph.nodes,...nodes],edges:[...graph.edges.filter(e=>e.id!==connectionId),...edges]};
  const result=placement?next:autoLayout(next,[...items,...added]);
  return {graph:result,items:added,selectedId:remap.get(template.entryId)!};
}
export function captureTemplate(graph:StoryGraph,ids:string[],items:Interstitial[],name:string):StoryTemplate|undefined {
  const nodes=graph.nodes.filter(n=>ids.includes(n.id)&&n.kind!=='source');if(!nodes.length)return;
  const selected=new Set(nodes.map(n=>n.id)),edges=graph.edges.filter(e=>selected.has(e.from)&&selected.has(e.to));
  const entry=nodes.find(n=>!edges.some(e=>e.to===n.id&&e.from!==n.id))??nodes[0];
  const settings=Object.fromEntries(nodes.map(n=>[n.id,interstitialSettings(items.find(i=>i.id===n.interstitialId)!)]));
  return {id:freshId(),name:name.trim()||'My template',entryId:entry.id,nodes:nodes.map(n=>({...n,referenceId:selected.has(n.referenceId??'')?n.referenceId:undefined})),edges,settings};
}
