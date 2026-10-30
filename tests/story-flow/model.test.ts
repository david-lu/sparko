import { describe,expect,it } from 'vitest';
import { autoLayout,connect,createNode,edge,freshId,migrateGraph,nodeDuration,removeNodes,runtimeFlow,splitSource,splitClip,type StoryGraph } from '../../src/features/story-flow/model';
import { captureTemplate,instantiateTemplate,makePreset } from '../../src/features/story-flow/templates';
import { advanceSession,answerSession,branchSession,startSession,createTimelineExample } from '../../src/features/call-response/model';
import { flowTransition } from '../../src/features/call-response/transitions';
import { storyDependency } from '../../src/features/story-flow/dependencies';
import { storyGraphSchema } from '../../src/features/story-flow/schema';
import { emptyAnalysis,type Project } from '../../src/features/project/types';
import { packProject,unpackProject } from '../../src/features/project/archive';
import { ProjectHistory } from '../../src/features/project/ProjectHistory';

const asset=crypto.randomUUID();
const project=():Project=>({id:'project',name:'Story',updatedAt:1,source:{name:'story.mp4',assetId:asset},interstitials:[],subtitle:null,analysis:emptyAnalysis()});
const initial=()=>migrateGraph(project(),20);
const ready=(item:ReturnType<typeof createNode>['item'])=>({...item,phase:'ready' as const,result:{assetId:asset,url:`asset:${asset}`,start:2,duration:item.duration,totalDuration:20}});
describe('story clip graph',()=>{
  it('splits source ranges without losing frames and keeps the old outgoing route on the second part',()=>{
    const graph=initial(),id=graph.entryId,split=splitSource(graph,id,120);
    expect(split.nodes.map(n=>n.source&&[n.source.inFrame,n.source.outFrame])).toEqual([[0,120],[120,480]]);
    expect(split.edges).toMatchObject([{from:id,to:split.nodes[1].id}]);
    expect(splitSource(graph,id,0)).toBe(graph);expect(splitSource(graph,id,480)).toBe(graph);
  });
  it('uses actual rendered duration, and keeps planned durations for drafts',()=>{
    const {node,item}=createNode('simple');expect(nodeDuration(node,[item])).toBe(6);
    expect(nodeDuration(node,[{...ready(item),result:{...ready(item).result,duration:6.167}}])).toBe(6.167);
  });
  it('splits generated media without copying bytes and preserves branch routing on the second half',()=>{
    const result=instantiateTemplate(initial(),makePreset('question'),[]),node=result.graph.nodes.find(n=>n.kind==='conditional')!,items=result.items.map(ready);
    const divided=splitClip(result.graph,items,node.id,24),right=divided.graph.nodes.find(n=>n.id===divided.rightId)!;
    expect(divided.items[0].result?.assetId).toBe(items.find(i=>i.id===node.interstitialId)!.result.assetId);
    expect(divided.graph.nodes.find(n=>n.id===node.id)).toMatchObject({kind:'simple',trim:{inFrame:0,outFrame:24},crossfadeEnd:0});expect(right).toMatchObject({kind:'conditional',trim:{inFrame:24,outFrame:96},crossfadeStart:0});
    expect(divided.graph.edges.filter(e=>e.from===right.id&&e.event==='answer')).toHaveLength(2);expect(divided.graph.edges.some(e=>e.event==='fallback')).toBe(false);
    const flow=runtimeFlow(divided.graph,[...items,...divided.items],asset,20),leftScene=flow.scenes.find(s=>s.id===node.id)!,rightScene=flow.scenes.find(s=>s.id===right.id)!;
    expect(leftScene.clip.outFrame).toBe(rightScene.clip.inFrame);expect(rightScene.clip.outFrame-leftScene.clip.inFrame).toBe(96);expect(nodeDuration(right,[...items,...divided.items])).toBe(3);
    expect(storyGraphSchema.safeParse(divided.graph).success).toBe(true);
  });
  it('migrates regular pins into clip sequences and includes unfinished drafts',()=>{
    const p=project(),a=createNode('simple').item,b=createNode('simple').item;
    p.interstitials=[{...a,time:5},{...b,time:12}];const graph=migrateGraph(p,20);
    expect(graph.nodes.map(n=>n.kind)).toEqual(['source','simple','source','simple','source']);
    expect(graph.edges).toHaveLength(4);expect(graph.nodes.filter(n=>n.source).reduce((sum,n)=>sum+n.source!.outFrame-n.source!.inFrame,0)).toBe(480);
    expect(storyGraphSchema.safeParse(graph).success).toBe(true);
  });
  it('migrates a call-response group to independent nodes with routing and no group ownership',()=>{
    const example=createTimelineExample(asset,20),p={...project(),callResponse:example.flow,interstitials:example.interstitials};
    const graph=migrateGraph(p,20);expect(graph.nodes).toHaveLength(6);expect(graph.nodes.filter(n=>n.kind==='conditional')).toHaveLength(1);
    expect(graph.edges.filter(e=>e.event==='answer')).toHaveLength(2);expect(storyGraphSchema.safeParse(graph).success).toBe(true);
  });
  it('repairs the half-length legacy graph migration and leaves edited connection fades intact',()=>{
    const example=createTimelineExample(asset,20),p={...project(),crossfadeFrames:14,callResponse:example.flow,interstitials:example.interstitials};
    const graph=migrateGraph(p,20),generated=graph.nodes.find(n=>n.interstitialId)!;
    p.interstitials.find(i=>i.id===generated.interstitialId)!.groupId='legacy-group';
    generated.crossfadeStart=14/48;const incoming=graph.edges.find(e=>e.to===generated.id)!;delete incoming.crossfade;
    const restored=migrateGraph({...p,storyFlow:graph},20);expect(restored.edges.find(e=>e.id===incoming.id)?.crossfade).toBe(14/24);
    expect(restored.nodes.find(n=>n.id===generated.id)?.crossfadeStart).toBeUndefined();
    incoming.crossfade=.125;expect(migrateGraph({...p,storyFlow:graph},20).edges.find(e=>e.id===incoming.id)?.crossfade).toBe(.125);
  });
  it('reconnects a simple clip by replacing its existing route',()=>{
    let graph=initial();graph=splitSource(graph,graph.entryId,120);
    const {node}=createNode('simple');graph={...graph,nodes:[...graph.nodes,node]};
    const changed=connect(graph,graph.entryId,node.id);
    expect(changed.edges.filter(e=>e.from===graph.entryId)).toHaveLength(1);expect(changed.nodes.at(-1)?.referenceId).toBe(graph.entryId);
  });
  it('removes incident connections and clears dangling generation references',()=>{
    let graph=initial();graph=splitSource(graph,graph.entryId,120);const id=graph.entryId;
    graph.nodes[1].referenceId=id;const next=removeNodes(graph,[id]);expect(next.nodes).toHaveLength(1);expect(next.nodes[0].referenceId).toBeUndefined();expect(next.edges).toHaveLength(0);expect(next.entryId).toBe(next.nodes[0].id);
    const empty=removeNodes(next,[next.entryId]);expect(empty.nodes).toHaveLength(0);expect(empty.entryId).toBe('');expect(storyGraphSchema.safeParse(empty).success).toBe(true);
    expect(runtimeFlow(empty,[],asset,20).scenes).toHaveLength(0);
  });
  it('inserts templates with unique IDs and reconnects every terminal response',()=>{
    let graph=initial();graph=splitSource(graph,graph.entryId,120);const link=graph.edges[0];
    const result=instantiateTemplate(graph,makePreset('question'),[],link.id);
    expect(result.graph.nodes).toHaveLength(6);expect(result.items).toHaveLength(4);
    expect(result.graph.edges.filter(e=>e.to===link.to)).toHaveLength(2);
    expect(result.graph.edges.some(e=>e.from===link.from&&e.to===result.selectedId)).toBe(true);
    expect(storyGraphSchema.safeParse(result.graph).success).toBe(true);
    const again=instantiateTemplate(result.graph,makePreset('question'),result.items);
    expect(new Set(again.graph.nodes.map(n=>n.id)).size).toBe(10);
  });
  it('places a template entry exactly at a drop without moving existing clips or unrelated wires',()=>{
    let graph=initial();
    graph=splitSource(graph,graph.entryId,120);graph=splitSource(graph,graph.nodes.at(-1)!.id,120);
    graph={...graph,nodes:graph.nodes.map((n,i)=>({...n,x:-800+i*460,y:-320+i*140})),edges:graph.edges.map(e=>({...e,points:[{id:freshId(),x:-120,y:270}]}))};
    const template=makePreset('question'),entry=template.nodes.find(n=>n.id===template.entryId)!;
    template.edges[0].points=[{id:'saved-bend',x:entry.x+175,y:entry.y-120}];
    const result=instantiateTemplate(graph,template,[],graph.edges[0].id,{x:-250,y:550});
    expect(result.graph.nodes.slice(0,graph.nodes.length)).toEqual(graph.nodes);
    expect(result.graph.edges.find(e=>e.id===graph.edges[1].id)).toEqual(graph.edges[1]);
    expect(result.graph.nodes.find(n=>n.id===result.selectedId)).toMatchObject({x:-250,y:550});
    const placed=result.graph.nodes.slice(graph.nodes.length);
    placed.forEach((n,i)=>{expect(n.x+250).toBe(template.nodes[i].x-entry.x);expect(n.y-550).toBe(template.nodes[i].y-entry.y);});
    const bend=result.graph.edges.find(e=>e.points?.some(p=>p.x===-75))!.points![0];
    expect(bend).toMatchObject({x:-75,y:430});expect(bend.id).not.toBe('saved-bend');
    expect(result.graph.edges.filter(e=>e.to===graph.edges[0].to)).toHaveLength(2);
    expect(storyGraphSchema.safeParse(result.graph).success).toBe(true);
  });
  it('captures selected interstitials as reusable settings without source assets or rendered media',()=>{
    const result=instantiateTemplate(initial(),makePreset('question'),[]),ids=result.graph.nodes.filter(n=>n.interstitialId).map(n=>n.id);
    const template=captureTemplate(result.graph,ids,result.items,'Quiz')!;
    expect(template.nodes).toHaveLength(4);expect(template.nodes.every(n=>!n.source)).toBe(true);
    const next=instantiateTemplate(initial(),template,[]);expect(next.items.every(i=>!i.result&&i.phase==='draft')).toBe(true);
  });
  it('plays conditional routing at the clip boundary, repeats when enabled, and follows the default otherwise',()=>{
    const result=instantiateTemplate(initial(),makePreset('question'),[]);result.graph.entryId=result.graph.nodes.find(n=>n.kind==='conditional')!.id;
    const flow=runtimeFlow(result.graph,result.items.map(ready),asset,20),start=startSession(flow,true),rule=result.graph.edges.find(e=>e.from===start.sceneId&&e.event==='answer')!;
    const chosen=answerSession(flow,start,' YES. ');expect(chosen.outcome).toBe(rule.id);
    expect(advanceSession(flow,chosen,95).sceneId).toBe(start.sceneId);expect(advanceSession(flow,chosen,96).sceneId).toBe(rule.to);
    expect(advanceSession(flow,start,96).loopIteration).toBe(2);
    result.graph.nodes.find(n=>n.id===start.sceneId)!.loop=false;
    const once=runtimeFlow(result.graph,result.items.map(ready),asset,20);expect(advanceSession(once,start,96).sceneId).toBe(rule.to);
  });
  it('loops exactly N cycles, or waits for the manual Continue action',()=>{
    let graph=initial();const {node,item}=createNode('looped');node.loopCount=3;graph={...graph,entryId:node.id,nodes:[...graph.nodes,node],edges:[edge(node.id,graph.entryId)]};
    const flow=runtimeFlow(graph,[ready(item)],asset,20),session=startSession(flow,true);
    expect(advanceSession(flow,session,96*2).sceneId).toBe(node.id);expect(advanceSession(flow,session,96*3).sceneId).toBe(graph.nodes[0].id);
    graph.nodes.at(-1)!.loopCount=0;const manual=runtimeFlow(graph,[ready(item)],asset,20);
    const next=branchSession(manual,startSession(manual,true),`${node.id}:continue`);expect(advanceSession(manual,next,96).sceneId).toBe(graph.nodes[0].id);
  });
  it('stores independent fades on connections and keeps generated entry fades before the cut',()=>{
    const a=createNode('simple'),b=createNode('simple'),c=createNode('simple');
    const graph:StoryGraph={...initial(),nodes:[a.node,b.node,c.node],entryId:a.node.id,edges:[{...edge(a.node.id,b.node.id),crossfade:.75},{...edge(b.node.id,c.node.id),crossfade:.25}]};
    let flow=runtimeFlow(graph,[ready(a.item),ready(b.item),ready(c.item)],asset,20);
    expect(flowTransition(flow,flow.edges[0])).toMatchObject({startFrame:-18,frames:18});
    expect(flowTransition(flow,flow.edges[1])).toMatchObject({startFrame:-6,frames:6});
    graph.edges[0].crossfade=0;flow=runtimeFlow(graph,[ready(a.item),ready(b.item),ready(c.item)],asset,20);
    expect(flowTransition(flow,flow.edges[0])).toBeUndefined();expect(flowTransition(flow,flow.edges[1])?.frames).toBe(6);
  });
  it('ignores obsolete reference selections and resolves cycles through saved footage',()=>{
    const a=createNode('simple'),b=createNode('simple');a.node.referenceId=b.node.id;b.node.referenceId=a.node.id;
    const graph={...initial(),nodes:[a.node,b.node],entryId:a.node.id};
    expect(storyDependency(graph,[ready(a.item),ready(b.item)],asset,20,a.item.id).blocked).toMatch(/Connect an incoming clip/);
    graph.edges=[edge(a.node.id,b.node.id),edge(b.node.id,a.node.id)];
    expect(storyDependency(graph,[ready(a.item),ready(b.item)],asset,20,a.item.id).blocked).toBeUndefined();
    expect(storyDependency(graph,[a.item,b.item],asset,20,a.item.id).blocked).toMatch(/Generate/);
  });
  it('generation reads the connected upstream clip, and bridge generation needs its downstream clip',()=>{
    const graph=initial(),a=createNode('simple',graph.entryId);graph.nodes.push(a.node);graph.edges.push(edge(graph.entryId,a.node.id));
    const dependency=storyDependency(graph,[a.item],asset,20,a.item.id);expect(dependency.blocked).toBeUndefined();expect(dependency.reference?.before).toMatchObject({assetId:asset,inFrame:0,outFrame:480});
    a.item.method='comfy';expect(storyDependency(graph,[a.item],asset,20,a.item.id).blocked).toMatch(/following clip/);
  });
  it('validates imported graph endpoints, finite coordinates and duplicate IDs',()=>{
    const graph=initial();expect(storyGraphSchema.safeParse({...graph,edges:[edge(graph.entryId,'missing')]}).success).toBe(false);
    expect(storyGraphSchema.safeParse({...graph,nodes:[...graph.nodes,{...graph.nodes[0]}]}).success).toBe(false);
    expect(storyGraphSchema.safeParse({...graph,nodes:[{...graph.nodes[0],x:Infinity}]}).success).toBe(false);
  });
  it('preserves graphs, templates and fades through archives while remapping media IDs',async()=>{
    let graph=initial();graph=splitSource(graph,graph.entryId,120);const result=instantiateTemplate(graph,makePreset('question'),[],graph.edges[0].id);
    result.graph.templates.push(captureTemplate(result.graph,result.graph.nodes.map(n=>n.id),result.items,'Saved quiz')!);
    result.graph.edges[0].crossfade=.875;result.graph.nodes[0].x=-1200;result.graph.nodes[0].y=-800;
    const split=splitClip(result.graph,result.items,result.selectedId,48);
    split.graph.edges[0].points=[{id:'bend',x:-350,y:-200}];
    const p={...project(),storyFlow:split.graph,interstitials:[...result.items,...split.items]};const signal=new AbortController().signal;
    const blob=await packProject(p,[{id:asset,name:'source.mp4',blob:new Blob(['fixture'],{type:'video/mp4'})}],signal,()=>{});
    const restored=await unpackProject(blob,signal,()=>{});expect(restored.project.storyFlow?.nodes).toHaveLength(7);expect(restored.project.storyFlow?.templates[0].name).toBe('Saved quiz');expect(restored.project.storyFlow?.nodes.find(n=>n.id===split.rightId)?.trim).toEqual({inFrame:48,outFrame:144});
    expect(restored.project.storyFlow?.nodes[0].source?.assetId).toBe(restored.project.source.assetId);expect(restored.project.source.assetId).not.toBe(asset);
    expect(restored.project.storyFlow?.edges).toEqual(split.graph.edges);
    expect(restored.project.storyFlow?.nodes[0]).toMatchObject({x:-1200,y:-800});
  });
  it('records a template insertion as one undoable document edit',()=>{
    const before={...project(),storyFlow:initial()},result=instantiateTemplate(before.storyFlow,makePreset('question'),[]),after={...before,storyFlow:result.graph,interstitials:result.items};
    const history=new ProjectHistory();history.record(before,after);expect(history.undoLabel).toBe('Add clips');expect(history.target('undo')?.storyFlow?.nodes).toHaveLength(1);history.commit('undo');expect(history.target('redo')?.storyFlow?.nodes).toHaveLength(5);
  });
  it('archives every imported source and its retained original with independent asset remapping',async()=>{
    const graph=initial(),extra=freshId(),original=freshId();graph.nodes.push({...graph.nodes[0],id:'extra',name:'Another video',source:{assetId:extra,originalAssetId:original,duration:12,inFrame:24,outFrame:288}});
    const signal=new AbortController().signal,blob=await packProject({...project(),storyFlow:graph},[asset,extra,original].map(id=>({id,name:`${id}.mp4`,blob:new Blob(['media'],{type:'video/mp4'})})),signal,()=>{});
    const result=await unpackProject(blob,signal,()=>{}),source=result.project.storyFlow!.nodes[1].source!;
    expect(result.assets).toHaveLength(3);expect(source.assetId).not.toBe(extra);expect(source.originalAssetId).not.toBe(original);expect(source.duration).toBe(12);expect(result.assets.some(a=>a.id===source.originalAssetId)).toBe(true);
  });
});
