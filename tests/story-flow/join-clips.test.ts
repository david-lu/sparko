import { describe, expect, it } from 'vitest';
import { joinClips } from '../../src/features/story-flow/joinClips';
import { edge, runtimeFlow, splitClip, type StoryGraph, type StoryNode } from '../../src/features/story-flow/model';
import { sceneMediaRange } from '../../src/features/story-flow/mediaRange';
import type { Interstitial } from '../../shared/interstitials';

const source=(id:string,start=0,end=24,assetId='video'):StoryNode=>({id,name:id,kind:'source',x:100,y:100,loopCount:0,source:{assetId,duration:12,inFrame:start,outFrame:end}});
const chain=(nodes:StoryNode[]):StoryGraph=>({version:1,entryId:nodes[0].id,nodes,edges:nodes.slice(1).map((node,i)=>edge(nodes[i].id,node.id)),templates:[]});
const joined=(graph:StoryGraph,ids=graph.nodes.map(n=>n.id),items:Interstitial[]=[])=>{
  const result=joinClips(graph,items,ids);if(!result.ok)throw new Error(result.reasons.join('\n'));return result.graph;
};
const rejected=(graph:StoryGraph,reason:RegExp,ids=graph.nodes.map(n=>n.id),items:Interstitial[]=[])=>{
  const original=structuredClone(graph),result=joinClips(graph,items,ids);
  expect(result).toMatchObject({ok:false,reasons:expect.arrayContaining([expect.stringMatching(reason)])});expect(graph).toEqual(original);
};
const item:Interstitial={id:'render',label:'Render',time:0,start_range:1,end_range:1,duration:4,prompt:'',enable_prompt_expansion:false,phase:'ready',
  result:{assetId:'render-video',url:'',start:1,duration:4,totalDuration:6}};
const generated:StoryNode={id:'generated',name:'Generated',kind:'simple',x:100,y:100,loopCount:0,interstitialId:item.id};

describe('joining clips',()=>{
  it.each([[0,24,24,48],[0,12,36,60],[12,48,24,60],[24,60,0,48]])('uses graph order and spans gaps or overlaps (%s,%s → %s,%s)',(a,b,c,d)=>{
    const graph=chain([source('first',a,b),source('last',c,d)]),snapshot=structuredClone(graph);
    const result=joined(graph,['last','first']);
    expect(result.nodes).toHaveLength(1);expect(result.nodes[0]).toMatchObject({id:'first',x:100,y:100,source:{assetId:'video',inFrame:a,outFrame:d}});
    expect(result.edges).toEqual([]);expect(graph).toEqual(snapshot);
  });
  it('joins an arbitrary-length chain even when node and selection order are shuffled',()=>{
    const graph=chain(Array.from({length:100},(_,i)=>source(String(i),i*2,i*2+2)));
    graph.nodes.reverse();const result=joined(graph);
    expect(result.nodes).toHaveLength(1);expect(result.entryId).toBe('0');expect(result.nodes[0].source).toMatchObject({inFrame:0,outFrame:200});
  });
  it('preserves outside wiring, fades, references, entry and unique group membership',()=>{
    const graph=chain([source('before'),source('first',24,48),source('last',48,72),source('after',72,96)]);
    graph.entryId='last';graph.nodes[3].referenceId='last';
    graph.edges[0].videoCrossfade=.5;graph.edges[2].audioCrossfade=.25;graph.edges[2].points=[{id:'bend',x:60,y:70}];
    graph.groups=[{id:'g1',name:'First group',color:'blue',nodeIds:['first']},{id:'g2',name:'Second group',color:'green',nodeIds:['last','after']}];
    const result=joined(graph,['last','first']);
    expect(result.entryId).toBe('first');expect(result.nodes.find(n=>n.id==='after')!.referenceId).toBe('first');
    expect(result.edges).toEqual([graph.edges[0],{...graph.edges[2],from:'first'}]);
    expect(result.groups!.map(g=>g.nodeIds)).toEqual([['first'],['after']]);
    expect(runtimeFlow(result,[],'video',12).scenes.find(s=>s.id==='first')!.clip).toMatchObject({inFrame:24,outFrame:72});
  });
  it('restores a split generated clip without replacing its render or generation settings',()=>{
    const split=splitClip(chain([generated]),[item],generated.id,48),items=[item,...split.items];
    const result=joined(split.graph,undefined,items);
    expect(result.nodes[0].interstitialId).toBe(item.id);expect(result.nodes[0].trim).toBeUndefined();
    const scene=runtimeFlow(result,items,'',0).scenes[0];expect(sceneMediaRange(scene,24)).toMatchObject({assetId:'render-video',start:1,end:5});
    expect(items[0]).toEqual(item);
  });
  it('matches retained full renders to imported ranges and supports joins beyond a generated body',()=>{
    const full={...item,result:{...item.result!,assetId:'body-only',start:0,fullAssetId:'full-video',fullRange:{start:2,duration:4,totalDuration:8}}};
    const graph=chain([{...generated,trim:{inFrame:24,outFrame:48}},source('tail',144,168,'full-video')]);
    const result=joined(graph,undefined,[full]);
    expect(result.nodes[0]).toMatchObject({kind:'source',source:{assetId:'full-video',inFrame:72,outFrame:168}});
    expect(result.nodes[0].interstitialId).toBeUndefined();
  });
  it('recognizes two working copies of the same original source',()=>{
    const a=source('a',0,24,'working-a'),b=source('b',24,48,'working-b');
    a.source!.originalAssetId=b.source!.originalAssetId='original';
    expect(joined(chain([a,b])).nodes[0].source).toMatchObject({assetId:'working-a',originalAssetId:'original',inFrame:0,outFrame:48});
  });
  it('preserves behaviors and conditional exits from the last clip',()=>{
    const last={...source('last',24,48),loop:true,conditional:true,conditions:[{id:'yes',label:'Yes',values:['yes']}],defaultConditionId:'yes'};
    const graph=chain([source('first'),last]);graph.nodes.push(source('outside',48,72));
    graph.edges.push({...edge('last','outside','answer','Yes'),conditionId:'yes',values:['yes'],audioCrossfade:.3});
    const result=joined(graph,['first','last']);
    expect(result.nodes[0]).toMatchObject({loop:true,conditional:true,conditions:last.conditions,defaultConditionId:'yes'});
    expect(result.edges).toEqual([{...graph.edges[1],from:'first'}]);
  });
  it('reports insufficient selection, disconnected clips, cycles, and branches without changes',()=>{
    rejected(chain([source('one')]),/at least two/);
    const graph=chain([source('a'),source('b',24,48),source('c',48,72)]);
    rejected(graph,/not connected/,['a','c']);
    rejected({...graph,edges:[]},/not connected/);
    rejected({...graph,edges:[...graph.edges,edge('c','a')]},/cycle/);
    rejected({...graph,edges:[...graph.edges,edge('a','c')]},/branch/);
  });
  it('rejects connections into or out of the middle and internal interactive behavior',()=>{
    const graph=chain([source('a'),source('b',24,48)]);graph.nodes.push(source('outside',48,72));
    rejected({...graph,edges:[...graph.edges,edge('outside','b')]},/incoming connection/,['a','b']);
    rejected({...graph,edges:[...graph.edges,edge('a','outside')]},/branches outside/,['a','b']);
    rejected({...graph,edges:[...graph.edges,edge('a','a')]},/loops back/,['a','b']);
    graph.nodes[0].loop=true;rejected(graph,/Loop or Conditional/,['a','b']);
  });
  it('explains missing, running and different media',()=>{
    rejected(chain([generated,{...generated,id:'g2'}]),/no rendered video/);
    rejected(chain([generated,{...generated,id:'g2'}]),/still generating/,undefined,[{...item,phase:'rendering'}]);
    rejected(chain([source('a'),source('b',24,48,'different')]),/different source material/);
  });
  it('rejects reversed adjacent ranges and a nonpositive combined range',()=>{
    rejected(chain([source('a',48,72),source('b',0,48)]),/starts at or after/);
    rejected(chain([source('a',72,96),source('b',24,120),source('c',0,48)]),/starts at or after/);
  });
  it('reports every independent media, graph, behavior, and timing problem together',()=>{
    const graph=chain([{...source('a',72,96),loop:true},source('b',0,48,'other')]);
    graph.nodes.push({...generated,id:'draft'},source('disconnected',0,24,'third'));
    const result=joinClips(graph,[{...item,phase:'rendering'}],graph.nodes.map(n=>n.id));
    expect(result).toMatchObject({ok:false,reasons:expect.arrayContaining([
      expect.stringMatching(/not connected/),expect.stringMatching(/Loop or Conditional/),
      expect.stringMatching(/still generating/),expect.stringMatching(/no rendered video/),
      expect.stringMatching(/“b” uses different source/),expect.stringMatching(/“disconnected” uses different source/),
      expect.stringMatching(/starts at or after/),
    ])});
  });
});
