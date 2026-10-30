import { describe, expect, it } from 'vitest';
import { behaviors, conditionsFor, defaultCondition, normalizeConditions, outputPorts, setBehavior } from '../../src/features/story-flow/behaviors';
import { connect, edge, runtimeFlow, splitSource, type StoryGraph, type StoryNode } from '../../src/features/story-flow/model';
import { advanceSession, answerSession, startSession } from '../../src/features/call-response/model';
import { captureTemplate, instantiateTemplate } from '../../src/features/story-flow/templates';
import { storyGraphSchema } from '../../src/features/story-flow/schema';

const video=(id:string):StoryNode=>({id,name:id,kind:'source',source:{assetId:crypto.randomUUID(),inFrame:0,outFrame:24},x:0,y:0,loopCount:0});
function fixture(){let graph:StoryGraph={version:1,entryId:'a',nodes:['a','b','c'].map(video),edges:[],templates:[]};
  graph=setBehavior(graph,'a','conditional',true);const [yes,no]=conditionsFor(graph,graph.nodes[0]);
  graph=connect(graph,'a','b',undefined,yes.id);graph=connect(graph,'a','c',undefined,no.id);
  return {graph,yes,no};
}
describe('independent clip behaviors and named outputs',()=>{
  it.each([false,true])('conditional clips can loop=%s independently of branching',loop=>{
    const {graph:original,yes}=fixture(),graph=setBehavior(original,'a','loop',loop),flow=runtimeFlow(graph,[],graphAsset(graph),4),session=startSession(flow,true);
    expect(behaviors(graph.nodes[0])).toEqual({loop,conditional:true});
    const idle=advanceSession(flow,session,24);expect(idle.sceneId).toBe(loop?'a':'b');expect(idle.loopIteration).toBe(loop?2:1);
    const answered=answerSession(flow,session,yes.label);expect(advanceSession(flow,answered,23).sceneId).toBe('a');expect(advanceSession(flow,answered,24).sceneId).toBe('b');
  });
  it('turning a behavior off retains conditions and wires, but disables choice playback',()=>{
    const {graph:original}=fixture(),graph=setBehavior(original,'a','conditional',false);
    expect(graph.edges).toEqual(original.edges);expect(conditionsFor(graph,graph.nodes[0])).toEqual(conditionsFor(original,original.nodes[0]));
    const flow=runtimeFlow(graph,[],graphAsset(graph),4);expect(advanceSession(flow,startSession(flow,true),24).finished).toBe(true);expect(flow.storyInteractions?.a).toBeUndefined();
    const restored=setBehavior(graph,'a','conditional',true);expect(outputPorts(restored,restored.nodes[0])).toHaveLength(2);
  });
  it('a counted loop can branch early and follows its default condition when its count is exhausted',()=>{
    let {graph,yes,no}=fixture();graph=setBehavior(graph,'a','loop',true);graph.nodes[0].loopCount=3;graph.nodes[0].defaultConditionId=no.id;
    const flow=runtimeFlow(graph,[],graphAsset(graph),4),session=startSession(flow,true);
    expect(advanceSession(flow,session,48).sceneId).toBe('a');expect(advanceSession(flow,session,72).sceneId).toBe('c');
    expect(advanceSession(flow,answerSession(flow,session,yes.label),24).sceneId).toBe('b');
  });
  it('unconnected conditions have their own outputs and reconnecting one preserves the other wire and its fade',()=>{
    const {graph,yes,no}=fixture();graph.edges[0].crossfade=.5;
    const next=connect(graph,'a','c',graph.edges[0].id,yes.id);
    expect(next.edges).toHaveLength(2);expect(next.edges[0]).toMatchObject({conditionId:yes.id,to:'c',crossfade:.5});expect(next.edges[1]).toEqual(graph.edges[1]);
    next.edges=next.edges.filter(e=>e.conditionId!==no.id);expect(outputPorts(next,next.nodes[0]).find(p=>p.conditionId===no.id)).toMatchObject({label:no.label,edgeId:undefined});
    const connected=connect(next,'a','b',undefined,no.id);expect(connected.edges).toHaveLength(2);expect(storyGraphSchema.safeParse(connected).success).toBe(true);
  });
  it('templates preserve combined behaviors, condition identities and wire destinations across copies',()=>{
    let {graph,no}=fixture();graph=setBehavior(graph,'a','loop',true);graph.nodes[0].defaultConditionId=no.id;const template=captureTemplate(graph,['a','b','c'],[],'Branching loop')!;
    const copy=instantiateTemplate(graph,template,[],undefined,{x:200,y:300});const node=copy.graph.nodes.find(n=>n.id===copy.selectedId)!;
    expect(behaviors(node)).toEqual({loop:true,conditional:true});expect(outputPorts(copy.graph,node).slice(0,2).every(p=>!!p.edgeId)).toBe(true);expect(storyGraphSchema.safeParse(copy.graph).success).toBe(true);
    expect(defaultCondition(copy.graph,node)?.id).toBe(no.id);expect(storyGraphSchema.parse(copy.graph).nodes.find(n=>n.id===node.id)?.defaultConditionId).toBe(no.id);
  });
  it('splitting keeps the behaviors and conditions on the outgoing half only',()=>{
    let {graph}=fixture();graph=setBehavior(graph,'a','loop',true);const split=splitSource(graph,'a',12);
    expect(behaviors(split.nodes[0])).toEqual({loop:false,conditional:false});expect(behaviors(split.nodes.at(-1)!)).toEqual({loop:true,conditional:true});
    expect(outputPorts(split,split.nodes.at(-1)!).slice(0,2).every(p=>!!p.edgeId)).toBe(true);
    expect(split.nodes[0].defaultConditionId).toBeUndefined();expect(storyGraphSchema.safeParse(split).success).toBe(true);
  });
  it('uses one existing default for no choice and unmatched input, without an extra output',()=>{
    const {graph,no}=fixture();graph.nodes[0].defaultConditionId=no.id;
    const flow=runtimeFlow(graph,[],graphAsset(graph),4),session=startSession(flow,true);
    expect(advanceSession(flow,session,24).sceneId).toBe('c');
    expect(advanceSession(flow,answerSession(flow,session,'something else'),24).sceneId).toBe('c');
    expect(outputPorts(graph,graph.nodes[0])).toHaveLength(2);
    expect(outputPorts(graph,graph.nodes[0]).filter(p=>p.isDefault).map(p=>p.id)).toEqual([no.id]);
  });
  it('migrates a legacy self-repeat without adding a condition',()=>{
    const {graph}=fixture();graph.edges.push(edge('a','a','fallback','Otherwise'));
    const next=normalizeConditions(graph);expect(next.edges).toHaveLength(2);expect(outputPorts(next,next.nodes[0])).toHaveLength(2);
    expect(normalizeConditions(next)).toEqual(next);
  });
  it('maps a legacy fallback destination onto an existing condition and retains wire settings',()=>{
    const {graph,no}=fixture();delete graph.nodes[0].defaultConditionId;
    graph.edges=graph.edges.filter(e=>e.conditionId!==no.id);const old={...edge('a','c','fallback','Otherwise'),crossfade:.25,points:[{id:'bend',x:200,y:100}]};graph.edges.push(old);
    const next=normalizeConditions(graph);expect(outputPorts(next,next.nodes[0])).toHaveLength(2);expect(next.nodes[0].defaultConditionId).toBe(no.id);
    expect(next.edges.find(e=>e.id===old.id)).toMatchObject({...old,event:'answer',conditionId:no.id,label:no.label});expect(storyGraphSchema.safeParse(next).success).toBe(true);
  });
  it('merges duplicate legacy fallback and answer destinations without adding another output',()=>{
    const {graph,no}=fixture();delete graph.nodes[0].defaultConditionId;graph.edges.push(edge('a','c','fallback','Otherwise'));
    const next=normalizeConditions(graph);expect(next.edges).toHaveLength(2);expect(next.nodes[0].defaultConditionId).toBe(no.id);expect(outputPorts(next,next.nodes[0])).toHaveLength(2);
  });
});
const graphAsset=(graph:StoryGraph)=>graph.nodes[0].source!.assetId;
