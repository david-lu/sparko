import {describe,it,expect} from 'vitest';
import {createNode,edge,runtimeFlow,nodeMediaLayout,splitClip,type StoryGraph,type StoryNode} from '../../src/features/story-flow/model';
import {connectionReference} from '../../src/features/story-flow/references';
import type {Interstitial} from '../../shared/interstitials';

function fixture(){
  const before:StoryNode={id:'before',name:'Opening shot',kind:'source',x:0,y:0,loopCount:0,source:{assetId:'source',inFrame:0,outFrame:48,duration:10}};
  const after:StoryNode={...before,id:'after',name:'Ending shot',source:{...before.source!,inFrame:48,outFrame:96}};
  const {node,item}=createNode('simple',before.id);
  const generated:Interstitial={...item,phase:'ready',result:{assetId:'generated',url:'blob:generated',start:1,duration:2,totalDuration:4,
    reference:{mode:'bridge',before:{sceneId:before.id,assetId:'source',inFrame:0,outFrame:48},after:{sceneId:after.id,assetId:'source',inFrame:48,outFrame:96}}}};
  const graph:StoryGraph={version:1,entryId:before.id,nodes:[before,node,after],edges:[edge(before.id,node.id),edge(node.id,after.id)],templates:[]};
  return {graph,node,generated,flow:()=>runtimeFlow(graph,[generated],'source',10)};
}
describe('saved reference matching and timeline sections',()=>{
  it('compares saved assets and cut frames, independently of the next generation settings',()=>{
    const f=fixture();let flow=f.flow();expect(flow.edges.map(e=>connectionReference(flow,e).state)).toEqual(['match','match']);
    f.node.referenceId='after';f.generated.start_range=3;f.generated.end_range=3;flow=f.flow();expect(connectionReference(flow,flow.edges[0]).state).toBe('match');
    f.graph.nodes[0].source!.outFrame=47;flow=f.flow();expect(connectionReference(flow,flow.edges[0]).state).toBe('mismatch');expect(connectionReference(flow,flow.edges[1]).state).toBe('match');
    f.graph.nodes[2].source!.assetId='replacement';flow=f.flow();expect(connectionReference(flow,flow.edges[1]).state).toBe('mismatch');
    f.generated.previousResult=f.generated.result;f.generated.result=undefined;f.generated.phase='error';flow=f.flow();expect(connectionReference(flow,flow.edges[0]).state).toBe('mismatch');
  });
  it('keeps original loop references valid and catches changed loop endings',()=>{
    const f=fixture();f.graph.nodes[0]={...f.graph.nodes[0],kind:'looped',source:undefined,interstitialId:'loop'};
    const loop:Interstitial={...f.generated,id:'loop',result:{assetId:'loop-body',fullAssetId:'loop-full',url:'blob:loop',start:0,duration:2,totalDuration:2,fullRange:{start:1,duration:2,totalDuration:4}}};
    f.generated.result!.reference!.before={sceneId:'before',assetId:'loop-full',inFrame:24,outFrame:72};
    let flow=runtimeFlow(f.graph,[f.generated,loop],'source',10);expect(connectionReference(flow,flow.edges[0]).state).toBe('match');
    f.generated.result!.reference!.before={sceneId:'before',assetId:'loop-body',inFrame:0,outFrame:48};flow=runtimeFlow(f.graph,[f.generated,loop],'source',10);expect(connectionReference(flow,flow.edges[0]).state).toBe('match');
    f.graph.nodes[0].trim={inFrame:0,outFrame:24};flow=runtimeFlow(f.graph,[f.generated,loop],'source',10);expect(connectionReference(flow,flow.edges[0]).state).toBe('mismatch');
  });
  it('shows saved reference lengths without coloring trimmed generated footage as reference',()=>{
    const f=fixture();expect(nodeMediaLayout(f.node,[f.generated])).toEqual({before:1,body:2,after:1,total:4});
    f.generated.start_range=4;expect(nodeMediaLayout(f.node,[f.generated]).before).toBe(1);
    f.node.trim={inFrame:24,outFrame:48};expect(nodeMediaLayout(f.node,[f.generated])).toEqual({before:0,body:1,after:1,total:2});
    f.node.trim={inFrame:0,outFrame:24};expect(nodeMediaLayout(f.node,[f.generated])).toEqual({before:1,body:1,after:0,total:2});
    f.node.trim={inFrame:12,outFrame:36};expect(nodeMediaLayout(f.node,[f.generated])).toEqual({before:0,body:1,after:0,total:1});
  });
  it('does not flag a continuous split through a generated body as a reference mismatch',()=>{
    const f=fixture(),split=splitClip(f.graph,[f.generated],f.node.id,24),flow=runtimeFlow(split.graph,[f.generated,...split.items],'source',10);
    const internal=flow.edges.find(e=>e.from===f.node.id&&e.to===split.rightId)!;
    expect(connectionReference(flow,internal)).toMatchObject({state:'match',message:expect.stringContaining('continuous')});
  });
});
